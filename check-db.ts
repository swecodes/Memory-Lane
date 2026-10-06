import { getDb } from "./core/db";
console.log(getDb().prepare("select name from sqlite_master where type='table'").all());