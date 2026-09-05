import tempfile
import unittest
from pathlib import Path

import foundry_main


class FakeFoundryApplication:
    def initialize(self):
        return None

    def model_is_cached(self, _alias):
        return True

    def embed(self, texts):
        vectors = []
        for text in texts:
            lowered = text.lower()
            vectors.append(
                [
                    float("rag" in lowered or "retrieve" in lowered),
                    float("weather" in lowered),
                ]
            )
        return vectors

    def generate(self, _system_prompt, _question):
        return "RAG uses retrieve, augment, and generate. [Source 1]"

    def close(self):
        return None


class FoundryRagTests(unittest.TestCase):
    def setUp(self):
        self.old_app = foundry_main.APP
        self.old_database = foundry_main.DATABASE_FILE
        self.old_documents = foundry_main.DOCUMENTS_FOLDER
        self.old_minimum = foundry_main.MIN_SIMILARITY
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        documents = root / "documents"
        documents.mkdir()
        (documents / "rag.txt").write_text(
            "RAG uses retrieve, augment, and generate. " * 35,
            encoding="utf-8",
        )
        foundry_main.APP = FakeFoundryApplication()
        foundry_main.DATABASE_FILE = root / "data" / "foundry_rag.sqlite3"
        foundry_main.DOCUMENTS_FOLDER = documents
        foundry_main.MIN_SIMILARITY = 0.1

    def tearDown(self):
        foundry_main.APP = self.old_app
        foundry_main.DATABASE_FILE = self.old_database
        foundry_main.DOCUMENTS_FOLDER = self.old_documents
        foundry_main.MIN_SIMILARITY = self.old_minimum
        self.temp.cleanup()

    def test_index_and_grounded_answer(self):
        status = foundry_main.build_index()
        result = foundry_main.answer_question("How does RAG retrieve information?")
        self.assertEqual(status["document_count"], 1)
        self.assertGreater(status["chunk_count"], 0)
        self.assertIn("retrieve", result["answer"])
        self.assertEqual(result["sources"][0]["source"], "rag.txt")

    def test_unanswerable_question_uses_fallback(self):
        foundry_main.build_index()
        result = foundry_main.answer_question("What is the weather?")
        self.assertIn("enough information", result["answer"])
        self.assertEqual(result["sources"], [])

    def test_uploaded_documents_are_safe_and_do_not_overwrite(self):
        first = foundry_main.store_uploaded_document("lesson.txt", b"First lesson")
        second = foundry_main.store_uploaded_document("lesson.txt", b"Second lesson")
        self.assertEqual(first, "lesson.txt")
        self.assertEqual(second, "lesson-2.txt")
        self.assertEqual(
            (foundry_main.DOCUMENTS_FOLDER / second).read_text(encoding="utf-8"),
            "Second lesson",
        )
        with self.assertRaises(RuntimeError):
            foundry_main.store_uploaded_document("../outside.txt", b"Blocked")


if __name__ == "__main__":
    unittest.main()
