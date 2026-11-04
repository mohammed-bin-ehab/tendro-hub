// Teams -> projects -> sections. A person sees the projects of the teams they belong to; admins see all projects.
const { db } = require('./db');
const { cookies } = require('./auth');
const { isAdmin } = require('./permissions');

async function projectsFor(user) {
  if (isAdmin(user)) {
    return db.prepare('SELECT p.id,p.name,p.team_id,t.name AS team_name FROM projects p JOIN teams t ON t.id=p.team_id WHERE p.archived=0 ORDER BY p.id').all();
  }
  return db.prepare(`SELECT p.id,p.name,p.team_id,t.name AS team_name FROM projects p JOIN teams t ON t.id=p.team_id
    JOIN team_members tm ON tm.team_id=p.team_id AND tm.user_id=? WHERE p.archived=0 ORDER BY p.id`).all(user.id);
}
// the project chosen with the switcher (cookie), or the first one the user may see
async function currentProject(req) {
  if (req.projectInfo !== undefined) return req.projectInfo;
  const list = await projectsFor(req.user);
  const wanted = Number(cookies(req).project);
  const project = list.find((p) => p.id === wanted) || list[0] || null;
  req.projectInfo = project ? { ...project, all: list } : { all: list, id: null };
  return req.projectInfo;
}
async function canViewProject(user, projectId) {
  if (!projectId) return false;
  if (isAdmin(user)) return true;
  return Boolean(await db.prepare(`SELECT 1 AS ok FROM projects p JOIN team_members tm ON tm.team_id=p.team_id
    WHERE p.id=? AND tm.user_id=? AND p.archived=0`).get(projectId, user.id));
}
async function projectMembers(projectId) {
  return db.prepare(`SELECT u.id,u.name,u.username,u.role,u.active FROM users u JOIN team_members tm ON tm.user_id=u.id
    JOIN projects p ON p.team_id=tm.team_id WHERE p.id=? ORDER BY u.id`).all(projectId);
}
async function isProjectMember(projectId, userId) {
  return Boolean(await db.prepare(`SELECT 1 AS ok FROM projects p JOIN team_members tm ON tm.team_id=p.team_id
    WHERE p.id=? AND tm.user_id=?`).get(projectId, userId));
}
module.exports = { projectsFor, currentProject, canViewProject, projectMembers, isProjectMember };
