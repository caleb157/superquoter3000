#!/bin/bash
# Vercel "Ignored Build Step": exit 0 skips the deploy, exit 1 builds.
# Skips pushes that only change files the web app doesn't ship: Lovable's generated
# database types, Supabase migrations and edge functions (Lovable deploys those),
# the bun lockfiles and docs. Anything unsure builds.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ]; then echo "No previous deploy to compare with: building."; exit 1; fi
git cat-file -e "$base^{commit}" 2>/dev/null || git fetch --quiet --depth=100 origin "$base" 2>/dev/null
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then echo "Previous deploy commit not available: building."; exit 1; fi

if git diff --quiet "$base" HEAD -- . \
  ':(exclude)src/integrations/supabase/types.ts' \
  ':(exclude)supabase' \
  ':(exclude)bun.lock' \
  ':(exclude)bun.lockb' \
  ':(exclude)*.md'; then
  echo "Only database types, Supabase files, lockfiles or docs changed: skipping deploy."
  exit 0
fi
echo "App files changed: building."
exit 1
