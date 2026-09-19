// Offline Supabase facade for the browser regression. No production endpoint is used.
(() => {
  const user = { id: 'test-user', email: 'listener@example.test', user_metadata: {} };
  const db = { albums: [], songs: [], profiles: [{ id: user.id, handle: 'listener', is_admin: false, birth_year: 1990 }], ratings: [], song_ratings: [] };
  const writes = []; let nextId = 1;
  window.searchSaveFixture = { db, writes };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user, access_token: 'offline' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({data:{user}}) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    storage: { from: () => ({ getPublicUrl: () => ({data:{publicUrl:''}}) }) },
    from(table) {
      let op = 'read', payload, opts, filters = [], first = 0, last = Infinity, head = false;
      const query = {
        select(_columns, options) { head = !!options?.head; return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        order() { return query; }, limit(n) { last = n - 1; return query; }, range(a, b) { first = a; last = b; return query; },
        upsert(rows, options) { op = 'upsert'; payload = rows; opts = options; return query; },
        insert(rows) { op = 'insert'; payload = rows; return query; },
        async execute(single) {
          if (op === 'read') { const rows = (db[table] || []).filter(row => filters.every(match => match(row))).slice(first,last+1); return { data: head ? null : single ? rows[0] || null : structuredClone(rows), count: rows.length, error: null }; }
          if (!['albums','songs'].includes(table)) throw Error('Unexpected mutation: '+table);
          writes.push({ table, op, payload: structuredClone(payload) });
          const row = Array.isArray(payload) ? payload[0] : payload;
          const duplicate = (db[table] || []).find(saved => saved.external_source === row.external_source && saved.external_id === row.external_id);
          if (duplicate && opts?.ignoreDuplicates) return {data:null,error:null};
          if (duplicate) return {data:null,error:{code:'23505',message:'duplicate key'}};
          const saved = {id:nextId++,...row}; db[table].push(saved);
          return {data:single?saved:[saved],error:null};
        },
        single() { return query.execute(true); }, maybeSingle() { return query.execute(true); }, then(resolve,reject) {return query.execute(false).then(resolve,reject);}
      };return query;
    }
  };
  window.supabase = { createClient: () => client };
})();
