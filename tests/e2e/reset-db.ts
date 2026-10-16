// Recreates the E2E database with the same routine as the integration suite.
import setup from "../integration/global-setup";

setup().then(
  () => process.stdout.write("E2E database reset and migrated.\n"),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
