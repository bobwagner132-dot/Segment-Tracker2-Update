"""pytest configuration — isolate each test session's data dir BEFORE
any application module imports happen.
"""

import os
import sys
import tempfile
from pathlib import Path

# Ensure backend root is importable
BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

_tmp = tempfile.mkdtemp(prefix="cst-test-")
os.environ["CST_DATA_DIR"] = _tmp
