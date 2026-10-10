require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONDODB_URI || '';
  if (!uri) { console.log('NO_URI'); process.exit(0); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 6000 });
  try {
  const db = client.db('topflow');
    const names = await db.admin().listDatabases().then((r) => r.databases.map((d) => d.name));
    console.log('CONNECTED');
    console.log('DB_COUNT=' + names.length);
  } catch (e) {
    console.log('CONNECT_FAILED');
    console.log(String(e).slice(0, 200));
  } finally {
    await client.close();
  }
})();
