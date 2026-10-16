// Recreates the E2E database with the same routine as the integration suite.
import setup from "../integration/global-setup";

await setup();
process.stdout.write("E2E database reset and migrated.\n");
