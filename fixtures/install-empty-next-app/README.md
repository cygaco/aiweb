# Fresh Install Fixture

This fixture stands in for an empty application that has not installed WarpOS yet.
Phase 4 release gates use its presence to verify the fresh-install test surface is
declared. The installer dry run is the safe validation path for this baseline:

```bash
powershell -ExecutionPolicy Bypass -File ./install.ps1 -Target fixtures/install-empty-next-app -DryRun -SkipPrompt
```
