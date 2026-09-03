# ECE 391 — locks

Spinlocks, semaphores, and where the kernel actually uses them.

## spinlock

Busy-wait on a flag. Cheap when the hold time is short; disastrous when it is not.

```c
while (test_and_set(&lock)) ;
```

## semaphore

Counting version. Sleep instead of spin.

---

*next: rw locks*
