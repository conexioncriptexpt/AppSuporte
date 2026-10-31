# Helper: (re)create TEST admin/technicians in preview Mongo (idempotent). Does not print secrets.
import uuid
from datetime import datetime, timezone
import bcrypt
from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
PW = "TestConex#2026"
users = [("TEST Admin", "test_admin@cryptoconex-teste.pt", "super_admin"),
         ("TEST Técnico Um", "test_tecnico1@cryptoconex-teste.pt", "technician"),
         ("TEST Técnico Dois", "test_tecnico2@cryptoconex-teste.pt", "technician")]
for name, email, role in users:
    h = bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode()
    ex = db.users.find_one({"email": email})
    if ex:
        db.users.update_one({"email": email}, {"$set": {"password_hash": h, "active": True, "role": role}})
        print("updated", email)
    else:
        db.users.insert_one({"id": str(uuid.uuid4()), "name": name, "email": email, "password_hash": h, "role": role,
                             "active": True, "permissions": {"control": True, "privacy": True, "accessibility": True},
                             "created_at": datetime.now(timezone.utc).isoformat()})
        print("created", email)
db.login_attempts.delete_many({"email": {"$in": [u[1] for u in users]}})
