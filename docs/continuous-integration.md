# Continuous integration

Every pull request targeting `main` runs the read-only **PR checks / Full test suite** check. It regenerates the approved `public` publication and fails if that produces a diff, then runs every Node.js test.

To prevent merging when this check fails, a repository administrator can configure a branch ruleset in GitHub:

1. Open **Settings → Rules → Rulesets** and create a branch ruleset targeting the default branch (`main`).
2. Enable **Require status checks to pass** and select **PR checks / Full test suite** after the workflow has run at least once.
3. Enable **Require branches to be up to date before merging** if every PR should also be tested with the current `main` branch.
4. Save the ruleset in **Active** status.

The PR workflow has read-only repository permission, receives no production credentials, and cancels an older run when the same pull request is updated.
