import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import foundry_main as rag


class PrivateDocumentTests(unittest.TestCase):
    def test_private_documents_and_index_are_encrypted(self):
        secret = "The private project code is ORCHID-942."
        key = bytes(range(32))
        with tempfile.TemporaryDirectory() as temporary_folder:
            root = Path(temporary_folder)
            documents = root / "documents"
            database = root / "private.sqlite3"

            saved_name = rag.store_private_uploaded_document(
                "secret.txt", secret.encode("utf-8"), documents, key
            )
            encrypted_file = documents / (saved_name + rag.PRIVATE_DOCUMENT_SUFFIX)
            self.assertNotIn(secret.encode("utf-8"), encrypted_file.read_bytes())
            self.assertEqual(
                rag.load_documents(
                    documents, include_sample=False, encryption_key=key
                )[0]["text"],
                secret,
            )

            with patch.object(
                rag.APP, "embed", side_effect=lambda texts: [[1.0, 0.0] for _ in texts]
            ):
                status = rag.build_index(
                    documents,
                    database,
                    include_sample=False,
                    encryption_key=key,
                )
                results = rag.retrieve(
                    "What is the project code?",
                    database,
                    "private knowledge base",
                    encryption_key=key,
                )

            self.assertEqual(status["document_count"], 1)
            self.assertNotIn(secret.encode("utf-8"), database.read_bytes())
            self.assertEqual(results[0]["text"], secret)

    def test_private_vault_rejects_a_different_access_token(self):
        with tempfile.TemporaryDirectory() as temporary_folder:
            with patch.object(rag, "PRIVATE_VAULTS_FOLDER", Path(temporary_folder)):
                headers = {
                    "X-Private-Vault": "private-vault-test-01",
                    "Authorization": "Bearer " + "A" * 44,
                }
                rag.authorize_private_vault(headers)
                headers["Authorization"] = "Bearer " + "B" * 44
                with self.assertRaises(rag.AccessDeniedError):
                    rag.authorize_private_vault(headers)


if __name__ == "__main__":
    unittest.main()
