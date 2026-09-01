#!/bin/sh
#
# Apply the repository settings that the workflows assume but cannot create for
# themselves: who may merge to main, who may approve a release, and where the
# project site is served from.
#
# These are GitHub settings rather than files, so they live here as one
# idempotent script instead of as documentation nobody runs. Re-running it is
# safe; it replaces rather than appends.
#
# Needs the gh CLI, authenticated as an admin of the repository:
#   gh auth login
#   sh .github/scripts/setup-repo.sh

set -eu

REPO=${REPO:-Slash-ui/slash-port}
OWNER=${OWNER:-amin-slashui}
BRANCH=${BRANCH:-main}

say() { printf '\n== %s\n' "$1"; }

say "Repository: $REPO   Maintainer: @$OWNER"
gh api "repos/$REPO" --jq '"admin=" + (.permissions.admin | tostring)' >/dev/null

# ---------------------------------------------------------------------------
# 1. main is protected: every change arrives by pull request, and only the
#    maintainer's review can approve it.
#
#    `enforce_admins` is deliberately false. GitHub does not let anyone approve
#    their own pull request, so with it on, a solo maintainer could never merge
#    their own work at all. Off, everybody else still needs @OWNER's review and
#    the maintainer can merge their own after CI passes.
#
#    The release branches are exempt from nothing: the release pull request is
#    opened by the bot, so the maintainer *can* approve it, which is exactly
#    the gate we want on a publish.
# ---------------------------------------------------------------------------
say "Protecting $BRANCH"
gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
	-H 'Accept: application/vnd.github+json' \
	--input - <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "test (ubuntu-latest, node 22)",
      "test (macos-latest, node 22)",
      "test (windows-latest, node 22)",
      "commit messages",
      "tarball contents",
      "secret scan"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "block_creations": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

# ---------------------------------------------------------------------------
# 2. Publishing waits for the maintainer.
#
#    The publish job runs in this environment, so the npm token is not readable
#    and the job does not start until @OWNER approves the deployment. This is
#    the second of the two gates: the first is merging the release pull
#    request.
# ---------------------------------------------------------------------------
say "Requiring @$OWNER to approve every npm publish"
owner_id=$(gh api "users/$OWNER" --jq .id)
gh api -X PUT "repos/$REPO/environments/npm-publish" \
	-H 'Accept: application/vnd.github+json' \
	--input - <<JSON
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{ "type": "User", "id": $owner_id }],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false }
}
JSON

# ---------------------------------------------------------------------------
# 3. The project site is built by .github/workflows/pages.yml rather than
#    served from a branch, so there is no generated HTML in the history.
# ---------------------------------------------------------------------------
say "Serving GitHub Pages from the Actions workflow"
if gh api "repos/$REPO/pages" >/dev/null 2>&1; then
	gh api -X PUT "repos/$REPO/pages" -f 'build_type=workflow'
else
	gh api -X POST "repos/$REPO/pages" -f 'build_type=workflow'
fi

# ---------------------------------------------------------------------------
# 4. Squash merges only, so main stays linear and every commit on it is a
#    Conventional Commit that the release pipeline can read. The pull request
#    title becomes that commit subject, which is why CI checks the title too.
# ---------------------------------------------------------------------------
say "Squash merges only, with the pull request title as the subject"
gh api -X PATCH "repos/$REPO" \
	-F allow_squash_merge=true \
	-F allow_merge_commit=false \
	-F allow_rebase_merge=false \
	-F allow_auto_merge=true \
	-F delete_branch_on_merge=true \
	-f squash_merge_commit_title=PR_TITLE \
	-f squash_merge_commit_message=PR_BODY \
	>/dev/null

say "Done."
cat <<'NOTE'

Two things this script cannot do for you.

1. The npm token.

     a. Create a Granular Access Token on npmjs.com with publish rights to
        slash-port, and nothing else.
     b. gh secret set NPM_TOKEN --repo Slash-ui/slash-port --env npm-publish

   Scoping it to the environment rather than the repository means only the
   approved publish job can read it.

2. A token for the release pull request, which is optional.

   GitHub does not start workflows for events raised by GITHUB_TOKEN, so a
   release pull request opened by the workflow gets no CI run and its required
   checks stay pending. You can merge past that as an admin, or give the
   workflow a token of its own:

     a. Create a fine-grained personal access token scoped to this repository
        with Contents: read and write, and Pull requests: read and write.
     b. gh secret set RELEASE_TOKEN --repo Slash-ui/slash-port

   The workflow uses it when it is there and falls back to GITHUB_TOKEN when it
   is not.
NOTE
