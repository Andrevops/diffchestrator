## 2024-05-18 - Optimized Array Lookup in Sort Loop

**Learning:** Array search (`find` or `indexOf`) inside a `sort` comparator transforms what should be an O(N log N) sorting operation into an O(N^2) operation, causing major performance bottlenecks on large lists. In this case, `repos.find` was run inside the `sort` operation.
**Action:** Always pre-calculate complex lookups from related collections into a `Map` *before* entering the `sort` callback, effectively reducing the internal lookup to an O(1) operation and preserving overall O(N log N) time complexity.
