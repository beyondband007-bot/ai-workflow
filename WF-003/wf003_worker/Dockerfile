ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.12.3-bookworm
FROM ${PYTHON_BASE_IMAGE}

WORKDIR /app

COPY WF-003/wf003_worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY WF-003/wf003_worker ./wf003_worker

EXPOSE 3013

CMD ["uvicorn", "wf003_worker.app:app", "--host", "0.0.0.0", "--port", "3013"]
