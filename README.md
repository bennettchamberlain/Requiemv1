## CI Server


Target Package and Folder Structure

database - Everything needed to setup the OpenSearch Database
api - Feathers API server - OpenAPI and/or GraphQL
chron - schedule server for Data ETL into digital memory, scheduled jobs for questions, insights, actions etc
agent - llm and rag server for making lang queries into the OpenSearch database
ops - K8s and OS Distro build tools
dev - dev setup tools


## Old Notes

Todo make our own distro
https://github.com/PJ-Singh-001/Cubic/wiki/Install-Cubic#-ubuntu-and-derivatives


Usage

```
sudo bash ci-server-setup.sh
```
This script will install the following packages:
- Docker
- Docker Desktop
- Node.js
- Nginx
