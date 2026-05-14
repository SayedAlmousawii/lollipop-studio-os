#!/usr/bin/env bash

set -euo pipefail

patterns=(
  "prisma.payment.create"
  "prisma.payment.createMany"
  # 75a appends adjustment invoice creation patterns here.
  # 77a appends gift card creation patterns here.
)

allowlist=(
  "src/modules/payments/payment.service.ts"
)

if [ "${#patterns[@]}" -eq 0 ]; then
  echo "Financial choke-point check passed: no forbidden patterns registered."
  exit 0
fi

for pattern in "${patterns[@]}"; do
  rg_args=(
    --line-number
    --fixed-strings
  )

  for allowed_path in "${allowlist[@]}"; do
    rg_args+=(--glob "!${allowed_path}")
  done

  rg_args+=("${pattern}" "src")

  if rg "${rg_args[@]}"; then
    echo "Forbidden financial choke-point pattern found: ${pattern}" >&2
    exit 1
  fi
done

echo "Financial choke-point check passed."
