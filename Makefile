default: test

DOCKER_EXEC_CLI := docker exec -ti cli-local
test:
	uv sync --extra test
	uv run coverage run --source bio3dbeacons -m pytest --junitxml=report.xml tests
	uv run coverage xml -o coverage/cobertura-coverage.xml
	uv run coverage report -m

pre-commit:
	uv tool run pre-commit install && uv tool run pre-commit run --all

cli-test:
	$(DOCKER_EXEC_CLI) bash -c "uv sync --extra test && pytest tests"
