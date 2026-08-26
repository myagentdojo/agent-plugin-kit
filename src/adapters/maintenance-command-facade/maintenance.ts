#!/usr/bin/env bun
import { maintenanceCommandFacade } from "./interface"

if (maintenanceCommandFacade === undefined) {
  process.stderr.write(
    '{"record_type":"implementation-absent","package_identity":"agent-plugin-kit"}\n',
  )
  process.exitCode = 1
}
