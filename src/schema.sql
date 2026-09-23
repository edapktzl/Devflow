PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(org_id TEXT NOT NULL REFERENCES organizations(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('Owner','Admin','Member','Viewer')),PRIMARY KEY(org_id,user_id));
CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id),name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS team_members(team_id TEXT REFERENCES teams(id),user_id TEXT REFERENCES users(id),PRIMARY KEY(team_id,user_id));
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id),name TEXT NOT NULL,repo TEXT UNIQUE,slack_channel TEXT,deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS columns(id TEXT PRIMARY KEY,board_id TEXT REFERENCES boards(id),name TEXT NOT NULL,position INTEGER NOT NULL,UNIQUE(board_id,name));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT REFERENCES projects(id),column_id TEXT REFERENCES columns(id),parent_id INTEGER REFERENCES tasks(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',priority TEXT DEFAULT 'normal',assignee TEXT REFERENCES users(id),labels TEXT DEFAULT '[]',due_date TEXT,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,task_id INTEGER REFERENCES tasks(id),user_id TEXT REFERENCES users(id),body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),user_id TEXT REFERENCES users(id),body TEXT NOT NULL,reply_to TEXT REFERENCES messages(id),links TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT UNIQUE NOT NULL,project_id TEXT REFERENCES projects(id),task_id INTEGER,source TEXT NOT NULL,type TEXT NOT NULL,actor TEXT,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,event_id INTEGER REFERENCES events(id),user_id TEXT REFERENCES users(id),read_at INTEGER,UNIQUE(event_id,user_id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,org_id TEXT,actor TEXT,action TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),trigger TEXT NOT NULL,condition_status TEXT,action TEXT CHECK(action IN ('set_status','comment','slack')),value TEXT NOT NULL,enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,job_key TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,available_at INTEGER NOT NULL,lease_until INTEGER,error TEXT);
CREATE TABLE IF NOT EXISTS external_objects(project_id TEXT REFERENCES projects(id),kind TEXT NOT NULL,external_id TEXT NOT NULL,updated_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,kind,external_id));
CREATE TABLE IF NOT EXISTS task_links(task_id INTEGER REFERENCES tasks(id),kind TEXT NOT NULL,external_id TEXT NOT NULL,url TEXT,PRIMARY KEY(task_id,kind,external_id));
CREATE TABLE IF NOT EXISTS integrations(org_id TEXT REFERENCES organizations(id),provider TEXT NOT NULL,token TEXT NOT NULL,external_id TEXT,PRIMARY KEY(org_id,provider));
CREATE TABLE IF NOT EXISTS identities(provider TEXT,external_id TEXT,org_id TEXT,user_id TEXT REFERENCES users(id),PRIMARY KEY(provider,external_id,org_id));
CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY,user_id TEXT,org_id TEXT,provider TEXT,expires INTEGER);
CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT,key TEXT,request_hash TEXT,response TEXT,created_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resync_state(project_id TEXT PRIMARY KEY REFERENCES projects(id),last_completed INTEGER,last_full INTEGER,lease_until INTEGER,last_error TEXT);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status,available_at);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id,id);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id,deleted_at);

-- Durable outbound requests. Never delete/reuse keys while a client may retry.
CREATE TABLE IF NOT EXISTS github_commands(
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 key TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),
 repo TEXT NOT NULL,
 action TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 request TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','rejected','uncertain')),
 response TEXT,
 error_status INTEGER,
 error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(user_id,key)
);
