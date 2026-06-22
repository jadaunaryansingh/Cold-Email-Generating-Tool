import os
from dotenv import load_dotenv

# Load environment variables from .env in project root
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
PORT = int(os.getenv("PORT", 8000))
HOST = os.getenv("HOST", "0.0.0.0")
GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")

# Ensure tokens and uploads directories exist
os.makedirs("tokens", exist_ok=True)
os.makedirs("uploads", exist_ok=True)
