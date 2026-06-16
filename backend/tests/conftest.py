import os

os.environ["DATABASE_URL"] = "sqlite:///./test_pytest.db"
os.environ["IMPORT_TMP_DIR"] = "./tmp_imports_test"
