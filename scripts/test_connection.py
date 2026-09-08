import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(
    dbname="foodbridge",
    user="postgres",
    password=os.environ.get("DB_PASSWORD"),
    host="localhost",
    port="5432"
)
cur = conn.cursor()
cur.execute("SELECT postgis_version();")
print("PostGIS version:", cur.fetchone())
conn.close()