// Delete projects and their files: npx tsx scripts/delete-project.ts <id> [id…]
import { deleteProject, getProject } from "../src/lib/projects";
for (const id of process.argv.slice(2)) {
  if (!getProject(id)) console.log("not found", id);
  else (deleteProject(id), console.log("deleted", id));
}
