import { openDb } from "./store";
import { createNotesServer } from "./server";

const db = openDb();
const port = Number(process.env.PORT ?? 3002);

createNotesServer(db).listen(port, () => {
  console.log(`Notes app listening on http://localhost:${port}`);
});
