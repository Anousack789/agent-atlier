import type { Project, Repository } from "./types";

export function projectRepositories(project: Project): Repository[] {
  return project.repositories ?? [{ id: "main", name: project.name, path: project.path }];
}
