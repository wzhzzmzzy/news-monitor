# Quickstart: Dynamic Historical Analysis

## Generate a 24-hour report (Historical Mode)
```bash
pnpm dev report --start "26-02-10 10:00" --end "26-02-11 10:00"
```

## Generate a report for today from 8 AM (Single-Day Mode)
```bash
pnpm dev report --start "26-02-13 08:00"
```
*Note: If `--end` is omitted, it defaults to the current time.*

## Constraints
- The time range between `--start` and `--end` cannot exceed **7 days**.
- Format must be `yy-mm-dd hh:MM`.
