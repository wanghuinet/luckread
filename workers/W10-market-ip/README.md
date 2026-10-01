# W10 — Async / Queue / Job Execution

Canonical Worker identity: **W10**
Canonical responsibility: **Async / Queue / Job Execution**
Primary Tasks: **None**

Repository path `workers/W10-market-ip` is a physical path retained for repository compatibility. Worker authority comes from `docs/04-WORKER-MASTER-v1.0.md`.

Boundary:
- W10 executes asynchronous/background work under the authority of the owning Worker and approved Task/Event Contract.
- W10 does not receive an artificial Primary Task.
- W10 does not become a second owner of business state merely by executing a job.
- External market/IP ownership is not inferred from the historical directory name.