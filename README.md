## CI Server


### Target Package and Folder Structure

Backend

- ***api*** - Feathers API server - OpenAPI and/or GraphQL
    - ***database*** - Everything needed to setup the OpenSearch Database
    - ***chron*** - schedule server for Data ETL into digital memory, scheduled jobs for questions, insights, actions etc
- ***agent*** - llm and rag server for making lang queries into the OpenSearch database

Front End

- ***client** - front end web code - TS / Tailwind / React
    - ***native*** - capacitor / electron code for mobile and desktop
    - ***xr*** - unity and threejs code  

Other

- ***ops*** - K8s and OS Distro build tools
    - ***queue** - some worker scheduler
- ***dev*** - dev setup tools


#### Old Notes

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
