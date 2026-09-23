const currentTime=()=>Date.now();

function columns(db,table){
 return db.prepare(`PRAGMA table_info(${table})`).all();
}

function rebuildMembers(db){
 const hasNull=db.prepare('SELECT 1 FROM members WHERE role IS NULL LIMIT 1').get();
 if(hasNull)throw Error('Cannot migrate members with NULL roles');
 const info=columns(db,'members');
 if(info.find(column=>column.name==='role')?.notnull===1)return;
 db.exec(`
  CREATE TABLE members_migration(
   org_id TEXT NOT NULL REFERENCES organizations(id),
   user_id TEXT NOT NULL REFERENCES users(id),
   role TEXT NOT NULL CHECK(role IN ('Owner','Admin','Member','Viewer')),
   PRIMARY KEY(org_id,user_id)
  );
  INSERT INTO members_migration(org_id,user_id,role) SELECT org_id,user_id,role FROM members;
  DROP TABLE members;
  ALTER TABLE members_migration RENAME TO members;
 `);
}

const migrations=[
 {version:1,up(db){
   rebuildMembers(db);
   const idempotencyColumns=columns(db,'idempotency');
   if(!idempotencyColumns.some(column=>column.name==='created_at')){
    db.exec('ALTER TABLE idempotency ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE idempotency SET created_at=? WHERE created_at=0').run(currentTime());
   }
   db.exec(`
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
    CREATE INDEX IF NOT EXISTS oauth_states_expires ON oauth_states(expires);
    CREATE INDEX IF NOT EXISTS idempotency_created ON idempotency(created_at);
    CREATE INDEX IF NOT EXISTS notifications_user_read ON notifications(user_id,read_at,id);
    CREATE INDEX IF NOT EXISTS comments_task_created ON comments(task_id,created_at);
    CREATE INDEX IF NOT EXISTS events_task ON events(task_id,id);
   `);
 }}
];

export function migrate(db){
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
 const applied=new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row=>row.version));
 for(const migration of migrations){
  if(applied.has(migration.version))continue;
  db.exec('BEGIN IMMEDIATE');
  try{
   migration.up(db);
   db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(migration.version,currentTime());
   db.exec('COMMIT');
  }catch(error){
   try{db.exec('ROLLBACK');}catch{}
   throw error;
  }
 }
}
