// All server-side catalogue MusicBrainz callers must use this coordinator.
export class CatalogueDeferral extends Error {
  constructor(public reason: string, public retryMs = 0) { super(reason); }
}
export class CatalogueDatabaseError extends Error {
  cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "CatalogueDatabaseError";
    this.cause = cause;
  }
}

const DATABASE_CLOSE_RESERVE_MS = 6000;
const COORDINATION_RPC_MAX_MS = 3000;
const MUSICBRAINZ_POST_REQUEST_RESERVE_MS = 9500;
// Production lease acquisition can consume several seconds. The actual HTTP
// timeout shrinks below its eight-second ceiling so this admission floor still
// preserves the fixed post-request reserve.
const MUSICBRAINZ_START_MINIMUM_MS = 12000;
const ACQUIRE_RECOVERY_MINIMUM_MS = 4000;
const COORDINATION_RECOVERY_MINIMUM_MS = DATABASE_CLOSE_RESERVE_MS + 1000;

function isTimeout(error: unknown) {
  const value = error as Error;
  return value?.name === "TimeoutError" || /signal timed out|timed out/i.test(String(value?.message || value));
}

export function catalogueErrorCategory(error: unknown) {
  if (error instanceof CatalogueDeferral) return `deferral:${error.reason}`;
  const value = error as Error & { cause?: unknown };
  const message = String(value?.message || error || "");
  if (/lease expired|superseded|not owned|fenc/i.test(message)) return "lease_fencing";
  if (/\bacquir(?:e|ing)|Catalogue acquire/i.test(message)) return "acquisition";
  if (/Catalogue (?:rate|cooldown)/i.test(message)) return "coordination";
  if (/MusicBrainz 429|rate.limit/i.test(message)) return "musicbrainz_rate_limit";
  if (/MusicBrainz|fetch|network|response body/i.test(message)) return "musicbrainz_transport";
  if (/checkpoint|Catalogue album|Catalogue discovery/i.test(message)) return "checkpoint";
  if (/auth|permission|jwt|unauthor/i.test(message)) return "authorization";
  if (isTimeout(error) || isTimeout(value?.cause)) return "transport_timeout";
  if (error instanceof CatalogueDatabaseError) return "database_rpc";
  return "application";
}

function retryableAcquireTransportFailure(error: unknown) {
  const original = error instanceof CatalogueDatabaseError ? error.cause : error;
  if (isTimeout(error) || isTimeout(original)) return true;
  const value = original as Record<string, unknown> | null;
  const message = String(value?.message || original || "").trim();
  if (/^gateway timeout$/i.test(message)) return true;
  for (const candidate of [value?.status, value?.statusCode, value?.code]) {
    if (typeof candidate === "number" && [502, 503, 504].includes(candidate)) return true;
    if (typeof candidate === "string" && /^(502|503|504)$/.test(candidate.trim())) return true;
  }
  return false;
}

export function musicBrainzIdentity(contact: string | undefined) {
  const value = (contact || "").trim();
  const valid = /^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/.test(value) &&
    !/(?:example\.(?:com|org|net)|\.invalid|localhost)(?:$|[\/])/i.test(value);
  // A meaningful public application URL is permitted by MusicBrainz. Never
  // emit a placeholder email or log the configured contact/secret value.
  return `BankOfMusic/1.0 (${valid ? value : "https://bank-of-music.pages.dev/"})`;
}

export class CatalogueWorker {
  token = crypto.randomUUID();
  jobId: number | null = null;
  deadline: number;
  private owned = false;
  constructor(private db: any, budgetMs = 23000, private identity = musicBrainzIdentity(undefined)) {
    this.deadline = Date.now() + budgetMs;
  }
  remaining() { return this.deadline - Date.now(); }
  ensureBudget(minimumMs = 5000) {
    if (this.remaining() < minimumMs) throw new CatalogueDeferral("deadline");
  }
  async rpc(action: string, data: any = {}) {
    const closing = action === "finish" || action === "failure";
    const coordination = action === "rate" || action === "cooldown";
    if (!closing) this.ensureBudget(3500);
    const remainingBeforeRpc = this.remaining();
    if (coordination && remainingBeforeRpc <= DATABASE_CLOSE_RESERVE_MS) {
      throw new CatalogueDeferral("deadline");
    }
    const maximum = coordination ? COORDINATION_RPC_MAX_MS : 6000;
    const timeoutMs = Math.max(1, Math.min(maximum,
      closing ? remainingBeforeRpc : remainingBeforeRpc -
        (coordination ? DATABASE_CLOSE_RESERVE_MS : 3000)));
    const deadlineConstrained = coordination && timeoutMs < COORDINATION_RPC_MAX_MS;
    try {
      let query = this.db.rpc("catalogue_worker", {
        p_action: action, p_token: this.token, p_job_id: this.jobId, p_data: data
      });
      if (query.abortSignal) query = query.abortSignal(AbortSignal.timeout(timeoutMs));
      const { data: result, error } = await query;
      if (error) throw error;
      return result;
    } catch (error) {
      // Rate/cooldown changes are idempotent and do not commit catalogue
      // progress. A shortened timeout caused by the invocation deadline can
      // therefore be retried, while a full coordination timeout remains a
      // genuine database failure. Fenced writes always remain failures when
      // their outcome is uncertain.
      if (deadlineConstrained && isTimeout(error)) {
        throw new CatalogueDeferral("deadline");
      }
      throw new CatalogueDatabaseError(
        `Catalogue ${action} failed: ${String((error as Error).message || error)}`,
        error
      );
    }
  }
  async acquire(kind = "importer") {
    let result;
    try {
      result = await this.rpc("acquire", { kind });
    } catch (error) {
      // The acquire transaction may have committed even when its PostgREST
      // response is lost. Retry once with the same token; the database either
      // returns that exact live ownership or performs the original acquisition.
      // Never infer ownership from the timeout itself.
      if (!(error instanceof CatalogueDatabaseError) || !retryableAcquireTransportFailure(error) ||
          this.remaining() < ACQUIRE_RECOVERY_MINIMUM_MS) throw error;
      result = await this.rpc("acquire", { kind });
    }
    if (!result.busy && !result.idle) {
      this.owned = true;
      this.jobId = result.job?.id ?? null;
    }
    return result;
  }
  async coordinate(action: "rate" | "cooldown", data: any = {}) {
    const requestToken = crypto.randomUUID();
    const payload = { ...data, request_token: requestToken };
    try {
      return await this.rpc(action, payload);
    } catch (error) {
      // Rate and cooldown are recoverable only by asking PostgreSQL about the
      // exact logical operation. A retry never creates a fresh request token.
      if (!(error instanceof CatalogueDatabaseError) || !isTimeout(error) ||
          this.remaining() < COORDINATION_RECOVERY_MINIMUM_MS) throw error;
      return await this.rpc(action, payload);
    }
  }
  async finish(error?: unknown) {
    if (!this.owned) return null;
    const planned = error instanceof CatalogueDeferral;
    const result = await this.rpc(error && !planned ? "failure" : "finish", {
      error: error ? String((error as Error).message || error) : null,
      error_category: error ? catalogueErrorCategory(error) : null,
      defer_reason: planned ? error.reason : null,
      defer_ms: planned ? error.retryMs : 0
    });
    this.owned = false;
    return result;
  }
  async review(index: number, groupId: string) {
    if (!this.owned || this.jobId === null) {
      throw new CatalogueDatabaseError("Catalogue review requires an owned job");
    }
    const result = await this.rpc("review", { index, group_id: groupId });
    this.owned = false;
    return result;
  }
  async musicBrainzGet(path: string) {
    let lastFailure: unknown;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        this.ensureBudget(MUSICBRAINZ_START_MINIMUM_MS);
      } catch (error) {
        if (lastFailure) throw lastFailure;
        throw error;
      }
      // PostgreSQL allocates one exact future slot. A lost response recovers
      // that slot by request token instead of advancing the gate again.
      const { wait_ms: waitMs } = await this.coordinate("rate");
      if (waitMs) {
        if (waitMs + MUSICBRAINZ_START_MINIMUM_MS > this.remaining()) {
          throw new CatalogueDeferral("rate_limit", waitMs);
        }
        await new Promise(r => setTimeout(r, waitMs));
      }
      this.ensureBudget(MUSICBRAINZ_START_MINIMUM_MS);
      const controller = new AbortController();
      const requestBudget = Math.min(8000, this.remaining() - MUSICBRAINZ_POST_REQUEST_RESERVE_MS);
      const timeout = setTimeout(() => controller.abort(), requestBudget);
      let failure: unknown;
      let retryMs = 1500 * 2 ** (attempt - 1);
      let retryable = true;
      try {
        const response = await fetch(`https://musicbrainz.org/ws/2${path}`, {
          headers: { Accept: "application/json", "User-Agent": this.identity },
          signal: controller.signal
        });
        if (response.ok) {
          const result = await response.json(); // Timer covers body consumption too.
          await this.coordinate("cooldown", { milliseconds: 1100 });
          return result;
        }
        // Do not include provider bodies or headers in diagnostics.
        await response.body?.cancel();
        failure = new Error(`MusicBrainz ${response.status}`);
        retryable = [429, 502, 503, 504].includes(response.status);
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          retryMs = Math.max(retryMs, Number.isFinite(seconds)
            ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0);
        }
        retryMs = Math.min(retryMs, 86400000);
        await this.coordinate("cooldown", { milliseconds: retryMs });
        if (response.status === 429 || response.status === 503) {
          throw new CatalogueDeferral("rate_limit", retryMs);
        }
      } catch (error) {
        if (error instanceof CatalogueDeferral || error instanceof CatalogueDatabaseError) throw error;
        if (controller.signal.aborted && requestBudget < 8000) {
          throw new CatalogueDeferral("deadline");
        }
        failure = error;
      } finally {
        clearTimeout(timeout);
      }
      lastFailure = failure;
      if (!retryable || attempt === 5) throw failure;
      if (retryMs + 5000 > this.remaining()) {
        // Full request timeouts/network errors remain real failures. Aborts
        // caused by the shorter overall budget were deferred above.
        throw failure;
      }
      await this.coordinate("cooldown", { milliseconds: retryMs });
      await new Promise(r => setTimeout(r, retryMs));
    }
    throw new Error("MusicBrainz retry limit reached");
  }
}

// Bound DB waits as well as HTTP requests. An uncertain transaction outcome is
// never guessed: the next owner resumes from the database's committed cursor.
export async function catalogueFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.any([
    ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(7000)
  ]) });
}
