-- Runs once, on first start of an empty Postgres volume.
-- A separate database for the test suite, so tests never touch dev data.
CREATE DATABASE filestore_test;
