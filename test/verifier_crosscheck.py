# Cross-language proof for the findings log.
#
# The extension builds its chain in JavaScript with WebCrypto. The auditor's
# tool is Python. If the two disagree on a single byte of canonicalisation, the
# log is unverifiable and the whole feature is pointless -- so this runs the
# REAL emitted chain through the REAL cloakllm-verifier rather than asserting
# that the hashes ought to match.
#
# Usage: python test/verifier_crosscheck.py
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKSPACE = REPO.parent
sys.path.insert(0, str(WORKSPACE / "cloakllm-py"))
sys.path.insert(0, str(WORKSPACE / "cloakllm-verifier"))

from cloakllm_verifier.verify import verify_audit  # noqa: E402


def emit(target: Path) -> str:
    # No shell=True. On POSIX, shell=True with an argument LIST runs only the
    # first element and hands the rest to the shell as $0/$1/... -- so this
    # would have started a bare `node` REPL in CI and emitted nothing, while
    # looking like a normal call. node is a real executable on Windows too
    # (unlike npm/npx, which are batch files), so the shell is not needed
    # anywhere.
    out = subprocess.run(
        ["node", str(REPO / "test" / "emit_chain.mjs"), str(target)],
        capture_output=True, text=True, cwd=str(REPO),
    )
    if out.returncode != 0:
        print(out.stdout)
        print(out.stderr)
        raise SystemExit("emit_chain.mjs failed")
    return out.stdout.strip()


def show(label, result, expect_ok):
    state = "PASS" if bool(result["ok"]) == expect_ok else "FAIL"
    print(f"  [{state}] {label}")
    print(f"         ok={result['ok']} valid={result['valid']} "
          f"entries={result['entries']} final_seq={result['final_seq']}")
    for e in result["errors"]:
        print(f"         {e}")
    return bool(result["ok"]) == expect_ok


print()
print("=" * 70)
print("  JS-BUILT CHAIN -> PYTHON cloakllm-verifier")
print("=" * 70)

ok = True

# 1. The chain the extension actually produces must verify.
d1 = Path(tempfile.mkdtemp())
emitted = emit(d1)
print(f"\n  emitted: {emitted}\n")
ok &= show("JS-generated chain verifies in Python", verify_audit(str(d1)), True)

# 2. It must still FAIL when edited -- otherwise case 1 proves nothing.
d2 = Path(tempfile.mkdtemp())
emit(d2)
f = next(d2.glob("audit_*.jsonl"))
rows = [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines()]
warn_ix = next(i for i, r in enumerate(rows) if r["event_type"] == "guard_warning")
rows[warn_ix]["action"] = "heeded" if rows[warn_ix]["action"] == "sent_anyway" else "sent_anyway"
f.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
ok &= show("flipping one 'action' value is detected", verify_audit(str(d2)), False)

# 3. No planted value may appear in the exported bytes.
raw = next(d1.glob("audit_*.jsonl")).read_text(encoding="utf-8")
planted = {
    "card": "5500 0000 0000 0004",
    "email": "marie.dubois@example-eu.fr",
    "iban": "FR76 3000 6000 0112 3456 7890 189",
    "aws key": "AKIAIOSFODNN7EXAMPLE",
    "phone": "06 12 34 56 78",
}
leaks = []
for label, value in planted.items():
    digits = "".join(c for c in value if c.isdigit())
    if value in raw:
        leaks.append(label)
    elif len(digits) >= 8 and digits in "".join(c for c in raw if c.isdigit()):
        leaks.append(f"{label} (digits)")
print(f"\n  [{'PASS' if not leaks else 'FAIL'}] exported bytes contain no planted value")
if leaks:
    ok = False
    print(f"         leaked: {', '.join(leaks)}")

for p in (d1, d2):
    shutil.rmtree(p, ignore_errors=True)

print(f"\n  RESULT: {'all cross-checks passed' if ok else 'CROSS-CHECK FAILED'}\n")
raise SystemExit(0 if ok else 1)
