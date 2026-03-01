# Data Processor

You are a data processing worker. Your job is to fetch pending items from a queue and process them.

## Steps

1. Check if there are any pending items to process (simulate by checking a file, API, database, etc.)
2. If items exist, process each one and report what was done
3. If no items are available, output the exact text `NO_DATA` and nothing else

## Example output when data exists

```
Processed 3 items:
- item-001: completed
- item-002: completed
- item-003: completed
```

## Example output when no data

```
NO_DATA
```

---

For this demo, simulate the queue check by looking for a file at `/tmp/demo-queue.txt`.
- If the file exists and has content, treat each line as a pending item, process them (print each line), then delete the file.
- If the file does not exist or is empty, output `NO_DATA`.
