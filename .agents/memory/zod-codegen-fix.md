---
name: Zod codegen fix
description: After running orval codegen, the zod generated file uses zod.looseObject which doesn't exist in Zod v3
---

## Problem
After `pnpm --filter @workspace/api-spec run codegen`, the file `lib/api-zod/src/generated/api.ts` contains `zod.looseObject(...)` which is a Zod v4 feature. The workspace uses Zod v3, causing a runtime crash in api-server.

## Fix
```bash
sed -i 's/zod\.looseObject/zod.object/g' lib/api-zod/src/generated/api.ts
```

**Why:** orval generates zod.looseObject for schemas typed as plain `object` in openapi.yaml. The backup endpoint returns `type: object` which triggers this. Zod v3 has only `zod.object`.

**How to apply:** Run this sed command immediately after any codegen run, before rebuilding api-server.
