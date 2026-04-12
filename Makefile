default: test

DOCKER_EXEC_CLI := docker exec -ti cli-local
DOCKER_EXEC_MONGO := docker exec -ti 3d-beacons-client-mongodb-1
test:
	uv sync --extra test
	uv run coverage run --source bio3dbeacons -m pytest --junitxml=report.xml tests
	uv run coverage xml -o coverage/cobertura-coverage.xml
	uv run coverage report -m

pre-commit:
	uv tool run pre-commit install && uv tool run pre-commit run --all

cli-test:
	$(DOCKER_EXEC_CLI) bash -c "uv sync --extra test && pytest tests"

cli-load-db-data:
	$(DOCKER_EXEC_CLI) bash -c "snakemake --cores=2"

mongodb-show-collections: #example: make mongodb-show-collections username=lpdi
	$(DOCKER_EXEC_MONGO) mongosh --username $(username)
	# Inside the mongosh run for demo check:
	# 	use models
	#	db.modelCollection.find({_id:'P38398_1jm7.1.A_1_103'}).pretty()