# interview prep

Patterns I keep re-learning before every interview season.

## sliding window

Fixed or shrinking window over a sequence. Watch for the moment a constraint becomes satisfied, then record it.

```python
def longest_substring(s):
    seen, left, best = {}, 0, 0
    for right, ch in enumerate(s):
        if ch in seen and seen[ch] >= left:
            left = seen[ch] + 1
        seen[ch] = right
        best = max(best, right - left + 1)
    return best
```

## checklist

- clarify input size before choosing a data structure
- state the complexity out loud while coding
- test with empty, single-element, and duplicate inputs
