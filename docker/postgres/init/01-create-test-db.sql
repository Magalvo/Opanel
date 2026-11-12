-- Runs once, when the data volume is first initialised.
-- Integration tests use this database; the harness refuses any name not ending in _test.
CREATE DATABASE opanel_test OWNER opanel;
