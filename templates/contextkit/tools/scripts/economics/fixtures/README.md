# Economics Fixtures (EACP-03)

These are **SANITIZED, SYNTHETIC fixtures** with NO real transcript content.

They prove the EACP measurement **pipeline is correct on known inputs** — they do NOT validate that any real baseline (e.g., the provisional ~US$36k gross-cache-value figure) describes reality. Any claim leaning on those baselines stays `inferred`, never "fixture-tested."

Fixtures model a cache-heavy long session **SHAPE** (~95% cache-read share) only as a structural exercise to verify:
- Delta/cumulative normalization (`toDelta`)
- Attribution lenses (`inclusive`, `byAgent`, etc.)
- The **cumulative-summing trap** (§6 of ADR-0078): naive sum of cumulative events ≠ delta sum

## Files

- `usage-delta.json` — 6 canonical UsageEvents, bucketMode='delta', ordered by ts, for sessionId='fixture-sess-A'
- `usage-cumulative.json` — same 6 logical steps as CUMULATIVE running totals; `toDelta(this)` ≈ `usage-delta.json`
- `golden.json` — expected pipeline outputs (deltaTotalThroughput, naiveCumulativeSum, normalizedCumulativeTotal, lenses)
- `load-fixtures.mjs` — ESM loader, zero-dep
- `README.md` — this file

## Verification

```bash
node -e "
import('./load-fixtures.mjs').then(async ({loadFixtures})=>{
  const {normalizeEvent}=await import('../usage-event.mjs');
  const {toDelta,throughput}=await import('../usage-buckets.mjs');
  const {inclusive}=await import('../attribution-lenses.mjs');
  const {delta,cumulative,golden}=loadFixtures();
  
  // All delta events must normalize without error
  delta.forEach(e=>normalizeEvent(e));
  
  // Trap check: naive sum of cumulative > delta sum
  const deltaTotal=delta.reduce((s,e)=>s+throughput(e.buckets),0);
  const naive=cumulative.reduce((s,e)=>s+throughput(e.buckets),0);
  const normalized=toDelta(cumulative).reduce((s,e)=>s+throughput(e.buckets),0);
  
  console.log('TRAP_OK:', naive > deltaTotal && normalized === deltaTotal);
  console.log('GOLDEN_MATCH:', 
    golden.deltaTotalThroughput===deltaTotal && 
    golden.naiveCumulativeSum===naive && 
    golden.normalizedCumulativeTotal===normalized
  );
});
"
```

Must see: `TRAP_OK: true` and `GOLDEN_MATCH: true`
