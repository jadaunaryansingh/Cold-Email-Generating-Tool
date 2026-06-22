import os
import base64
import json
import re
import io
import pandas as pd
from pypdf import PdfReader
from groq import Groq
from backend.config import GROQ_API_KEY

class GroqService:
    def __init__(self):
        self.api_key = GROQ_API_KEY
        if self.api_key:
            self.client = Groq(api_key=self.api_key)
        else:
            self.client = None

    def is_configured(self) -> bool:
        return self.client is not None

    def extract_text_from_pdf(self, file_bytes: bytes) -> str:
        """
        Extracts plain text from PDF bytes using pypdf.
        """
        try:
            reader = PdfReader(io.BytesIO(file_bytes))
            text = ""
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            return text.strip()
        except Exception as e:
            return f"[Error parsing PDF: {str(e)}]"

    def extract_text_from_excel(self, file_bytes: bytes, filename: str) -> str:
        """
        Parses Excel or CSV bytes using pandas and converts to CSV string.
        """
        try:
            if filename.endswith(".csv"):
                df = pd.read_csv(io.BytesIO(file_bytes))
            else:
                df = pd.read_excel(io.BytesIO(file_bytes))
            df = df.dropna(how='all')
            return df.to_csv(index=False)
        except Exception as e:
            return f"[Error parsing Excel/CSV: {str(e)}]"

    def query_chatbot(self, user_prompt: str, file_bytes: bytes = None, filename: str = None) -> dict:
        """
        Queries Groq LLM. Extracts emails and returns structured contacts if found,
        along with conversational answers.
        """
        if not self.is_configured():
            return {
                "answer": "Groq API key is not configured. Please add it to your .env file.",
                "contacts": []
            }

        extracted_text = ""
        is_image = False
        base64_image = ""
        mime_type = "image/jpeg"

        # 1. Process File attachments
        if file_bytes and filename:
            fn_lower = filename.lower()
            if fn_lower.endswith(".pdf"):
                extracted_text = f"\n[Document Context from {filename}]:\n" + self.extract_text_from_pdf(file_bytes)
            elif fn_lower.endswith((".xlsx", ".xls", ".csv")):
                extracted_text = f"\n[Spreadsheet Context from {filename}]:\n" + self.extract_text_from_excel(file_bytes, filename)
            elif fn_lower.endswith((".png", ".jpg", ".jpeg", ".webp")):
                is_image = True
                if fn_lower.endswith(".png"):
                    mime_type = "image/png"
                elif fn_lower.endswith(".webp"):
                    mime_type = "image/webp"
                base64_image = base64.b64encode(file_bytes).decode("utf-8")
            else:
                # Treat as plain text
                try:
                    extracted_text = f"\n[Text Context from {filename}]:\n" + file_bytes.decode("utf-8")
                except:
                    extracted_text = f"\n[File name: {filename} uploaded but contains binary data]"

        # 2. Build model payload
        # System prompt that enforces double output: Conversational answer AND a JSON block for extracted contacts
        system_prompt = (
            "You are a helpful Cold Email Assistant.\n"
            "Your main task is to help the user extract email contacts for cold emailing and answer questions.\n\n"
            "CRITICAL: If the user uploads a document, photo, text, or asks you to find/extract contacts, "
            "you MUST locate all contact details including Name, Email, Company, and Role.\n"
            "You must return your response as a JSON object with exactly two keys:\n"
            "1. 'answer': A friendly conversational response text answering their message, explaining what you found, or giving tips. Use standard markdown for formatting.\n"
            "2. 'contacts': A list of extracted contacts. Each contact must be a dictionary with keys: 'Name', 'Email', 'Company', 'Role'. "
            "If any field is missing, use an empty string. If no contacts are found, return an empty list `[]`.\n\n"
            "Ensure the output is valid JSON. Do not return raw text outside of this JSON structure."
        )

        try:
            # We choose vision model if image is uploaded, else standard text model
            if is_image:
                model = "llama-3.2-11b-vision-preview"
                content_payload = [
                    {"type": "text", "text": f"{user_prompt}\n\nPlease extract any names, emails, companies, and roles you see in this attached photo/document."},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{base64_image}"
                        }
                    }
                ]
            else:
                model = "llama-3.3-70b-versatile"  # Excellent fast & smart model
                content_payload = f"{user_prompt}\n{extracted_text}"

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content_payload}
            ]

            # Groq chat completion in JSON mode
            response = self.client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=2048
            )

            response_content = response.choices[0].message.content
            parsed = json.loads(response_content)
            return {
                "answer": parsed.get("answer", "No response provided by bot."),
                "contacts": parsed.get("contacts", [])
            }

        except Exception as e:
            return {
                "answer": f"An error occurred while communicating with the chatbot service: {str(e)}",
                "contacts": []
            }

    def infer_name_from_email(self, email: str) -> str:
        """
        Uses Groq LLM to infer a clean first name of a person from their email address.
        """
        if not self.is_configured():
            return ""
        
        prompt = (
            f"Given the email address '{email}', identify and extract ONLY the person's first name.\n"
            "Guidelines:\n"
            "1. You must distinguish between the first name and the surname/last name/middle name. Return ONLY the first name (e.g., 'soumyadeep.sen@gmail.com' -> 'Soumyadeep', 'aryansinghjadaun@gmail.com' -> 'Aryan', 'sen.soumyadeep@gmail.com' -> 'Soumyadeep').\n"
            "2. If it contains initials and a full last name (e.g. 's.sen@corp.com' or 'jdoe@example.com'), try to guess the first name or return 'Friend' if not possible.\n"
            "3. Return ONLY the single capitalized word representing the first name. Do not include any punctuation, explanation, introduction or other words. If no first name can be guessed, return 'Friend'."
        )
        try:
            response = self.client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0,
                max_tokens=15
            )
            name = response.choices[0].message.content.strip()
            # Clean up response to ensure only alphabets are returned
            import re
            name = re.sub(r'[^a-zA-Z]', '', name)
            return name.capitalize() if name else "Friend"
        except Exception:
            return ""
