pipeline {
  agent any

  options { timestamps() }

  triggers { githubPush() }

  environment {
    DEPLOY_HOST = "***REMOVED***"
    DEPLOY_USER = "crono"
    DEPLOY_PATH = "/home/crono/delta-postgres"
  }

  stages {
    stage('Deploy') {
      steps {
        sshagent(['prod-ssh']) {
          sh '''
ssh -q -T -o LogLevel=ERROR -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} << EOF
set -e

cd ${DEPLOY_PATH}

git pull --ff-only origin master

docker compose up -d --build --force-recreate --remove-orphans

echo "Deploy complete"
EOF
          '''
        }
      }
    }
  }

  post {
    success { echo "✓ Deployed latest" }
    failure { echo "✗ Pipeline failed" }
    always { cleanWs() }
  }
}
