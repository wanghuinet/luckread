# W10 — Async / Queue / Job Execution

Canonical Worker identity: **W10**
Canonical responsibility: **Async / Queue / Job Execution**
Primary Tasks: **None**

Canonical repository path: `workers/W10-async`.

Boundary:
- W10 executes asynchronous/background work under the authority of the owning Worker and approved Task/Event Contract.
- W10 does not receive an artificial Primary Task.
- W10 does not become a second owner of business state merely by executing a job.
- External market/IP ownership is not inferred from a historical path name.
