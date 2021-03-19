const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwtDecode = require('jwt-decode');

const { getCurrentInvoke } = require('@vendia/serverless-express');

const AWS = require("aws-sdk");
const cognitoIdentity = new AWS.CognitoIdentity();
const stsClient = new AWS.STS();

const app = express();
const router = express.Router();

router.use(cors());
router.use(bodyParser.json());

const handleErrorAsync = func => (req, res, next) => {
    func(req, res, next)
        .catch((error) => next(error));
};

router.get('/url', handleErrorAsync(async (req, res, next) => {

    const { event } = getCurrentInvoke();

    const extractedIdToken = event.headers.Authorization;
    const decodedIdToken = jwtDecode(extractedIdToken);

    const cognitoInfos = {
        idToken: extractedIdToken,
        identityPoolId: process.env.COGNITO_IDENTITY_POOL_ID,
        userPoolUrl: process.env.COGNITO_USER_POOL_URL
    };

    const stsInfos = {
        roleToAssumeArn: process.env.STS_ROLE_ARN_TO_ASSUME,
        sessionName: decodedIdToken.sub
    };

    const quickSightInfos = {
        region: process.env.QUICKSIGHT_REGION,
        namespace: 'default',
        dashboard: {
            id: process.env.QUICKSIGHT_DASHBOARD_ID,
            disableReset: false,
            disableUndoRedo: false,
            sessionLifetime: 600
        },
        accountId: process.env.AWS_ACCOUNT_ID,
        user: {
            email: decodedIdToken.email,
            sessionName: decodedIdToken.sub,
            roleName: 'READER',
            iamRoleArn: stsInfos.roleToAssumeArn
        }
    };

    const credentials = await getConnectedCognitoUserTemporaryIAMCredentials(cognitoInfos, stsInfos);

    const quicksightApi = new AWS.QuickSight({
        region: quickSightInfos.region,
        credentials: {
            accessKeyId: credentials.Credentials.AccessKeyId,
            secretAccessKey: credentials.Credentials.SecretAccessKey,
            sessionToken: credentials.Credentials.SessionToken,
            expiration: credentials.Credentials.Expiration
        }
    });

    try {
        await createQuicksightUserIfNotExists(quicksightApi, quickSightInfos);
    } catch (err) {
        if (!err.code || err.code !== 'ResourceExistsException') {
            next(err);
        }
    }
    
    const quicksightUrl = await getQuicksightEmbeddedUrl(quicksightApi, quickSightInfos);

    res.status(200).json({ 
        url: quicksightUrl.EmbedUrl
    });
}));

async function getCognitoOpenIdToken(cognitoInfos) {

    const params = {
        IdentityPoolId: cognitoInfos.identityPoolId,
        Logins: {
            [cognitoInfos.userPoolUrl] : cognitoInfos.idToken
        }
    };

    const cognitoId = await cognitoIdentity.getId(params).promise();

    cognitoId.Logins = {
        [cognitoInfos.userPoolUrl] : cognitoInfos.idToken
    };

    return cognitoIdentity.getOpenIdToken(cognitoId).promise();
}

async function getConnectedCognitoUserTemporaryIAMCredentials(cognitoInfos, stsInfos) {

    const openIdToken = await getCognitoOpenIdToken(cognitoInfos);

    const stsParams = {
        RoleSessionName: stsInfos.sessionName,
        WebIdentityToken: openIdToken.Token,
        RoleArn: stsInfos.roleToAssumeArn
    };
    
    return stsClient.assumeRoleWithWebIdentity(stsParams).promise();
}

async function createQuicksightUserIfNotExists(quicksightApi, quickSightInfos) {

    const userToRegisterParams = {
        AwsAccountId: quickSightInfos.accountId,
        Email: quickSightInfos.user.email,
        IdentityType: 'IAM',
        Namespace: quickSightInfos.namespace,
        UserRole: quickSightInfos.user.roleName,
        IamArn: quickSightInfos.user.iamRoleArn,
        SessionName: quickSightInfos.user.sessionName
    };

    return quicksightApi.registerUser(userToRegisterParams).promise();
}

async function getQuicksightEmbeddedUrl(quicksightApi, quickSightInfos) {

    const dashboardParams = {
        AwsAccountId: quickSightInfos.accountId,
        DashboardId: quickSightInfos.dashboard.id,
        IdentityType: 'IAM',
        ResetDisabled: quickSightInfos.dashboard.disableReset,
        SessionLifetimeInMinutes: quickSightInfos.dashboard.sessionLifetime,
        UndoRedoDisabled: quickSightInfos.dashboard.disableUndoRedo
    };

    return quicksightApi.getDashboardEmbedUrl(dashboardParams).promise();
}

function errorHandler(err, req, res, next) {
    return res.status(500).json({
        status: 'error',
        message: err.message
    });
}

app.use('/', router);
app.use(errorHandler);

module.exports = app;
