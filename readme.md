# ODRL Editor

PLEASE NOTE: The ODRL Editor is currently is in proof of concept. 
The functionality will be changing rapidly through to the end of August 2026

You can access a live demo version of the current functionalities at [DIPS](https://dips.soton.ac.uk/odrl-editor-demo). 

In the very short term there is an issue with dropdown population at live demo site.
We are fixing this now and is not present in local deployments if you wish to look a this (see installation notes below)
Other main functionality runs correctly.



## **Main Goal/Functionalities**

The Open Digital Rights Language (ODRL) is a standardised machine-readable vocabulary and policy expression
language, maintained and developed by W3C. It allows data providers and consumers to explicitly define and
agree policies that can be used to automatically manage the permissions, prohibitions, and obligations controlling
the usage of digital content and services. ODRL is being increasingly adopted to help automate compliance
within ever more complex machine driven commercial ecosystems. However, the ODRL specification is complex
for non-specialist users and there is a lack of comprehensive user-facing tooling to assist in the creation of the
required policies. Therefore, the creation of machine processable policies remains difficult for business domain
experts who may not be specialists in ODRL and associated semantic development standards (e.g. JSON-LD
and RDF Turtle). 
Here we present the UoS Policy Editor actively developing towards solving this problem. 
We hope that this work will underpin the creation of a reference editor capability to enhance the evolution of the full ODRL specification



## **How To Install With Docker**

This project comes with a docker image which you can start on port 3050 (or choose another port by modifying `docker-compose.yml`).

### Instructions

1. Make sure you have Docker installed and running
2. After cloning (or otherwise) a copy of this repository, go to the the root directory of this project and run command `docker compose up -d --build`
3. Wait for the image to be created
4. You should then be able to access the application via browser at http:localhost:3050

#### Additional Configuration

None currently.

## **How To Install Without Docker**

### Requirements

Install python (with requirements.txt) and node.js (with Vite)

In the backend directory - python main.python
In the frontend directory - npm run developed

You should now be able to access the application via browser at http:localhost:5173

## Usage

### GUI

The GUI presents a number of panels

Further details may be found in the user guide (currently in development)

#### The Policy Metadata panel
Define overarching policy parameters

#### The Rule Builder and Rule Tabs panels
The core functionality of the development
Allows users to develop ODRL 2.2 compliant policy rule constructs

#### SHACL Inspector panel
Although the application attempts to guide the policy creation through dynamic validation of input this allows for additional policy validation at request

#### JSON-LD/TTL Output panel
Live viewing of the output machine-processable policy 

#### Human Summary panel
Live viewing of a human readable version of the current policy

#### Top panel buttons
Basic file management functions

Download/Upload policies - to/from local machine
Load Policy from server - to load examples
Add Simple Vocabulary - An evolving capability to allow very simple augmentation of dropdown vocabularies

#### Bottom panel buttons
Please do not use - currently deprecated

#### Adding vocabularies / ontologies
Currently only available on locally deployed versions
Placing (valid) files in backend/DEFAULT_VOCABULARIES will automatically add these



