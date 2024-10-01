require("dotenv").config()
const express = require("express")
const bodyParser = require("body-parser")
const RingCentral = require("@ringcentral/sdk").SDK
const WebSocket = require("ws")
const http = require("http")

const app = express()
app.use(bodyParser.json())

const PORT = process.env.PORT || 5000

const rcsdk = new RingCentral({
    server: process.env.RINGCENTRAL_SERVER_URL,
    clientId: process.env.RINGCENTRAL_CLIENT_ID,
    clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET
})

const platform = rcsdk.platform()

// Create an HTTP server to be used with both Express and WebSocket
const server = http.createServer(app)

// Create a WebSocket server that works with the HTTP server
const wss = new WebSocket.Server({ server })

app.get("/", (req, res) => {
    res.send("RingCentral API Integration with JWT Authentication")
})

/* ============== RING CENTRAL SUBSCRIPTION ================== */

// JWT login route
app.get("/login", async (req, res) => {
    console.log("login api called")
    try {
        const loginResponse = await platform.login({
            jwt: process.env.RINGCENTRAL_JWT
        })

        console.log("loginResponse", JSON.stringify(loginResponse))
        res.send("Login successful with JWT!")
    } catch (error) {
        // console.log(error)
        res.send("Login failed: " + error.message)
    }
})

platform.on(platform.events.loginSuccess, function (e) {
    console.log("LOGIN SUCCESSFUL")
    // subscribe_for_notification()
    read_subscriptions()
})

platform.on(platform.events.loginError, function (e) {
    console.log(
        "Unable to authenticate to platform. Check credentials.",
        e.message
    )
    process.exit(1)
})

/* Create a Webhok notification and subscribe for instant SMS message notification */
async function subscribe_for_notification() {
    var bodyParams = {
        eventFilters: [
            "/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true",
            "/restapi/v1.0/account/~/telephony/sessions"
            // "/restapi/v1.0/account/~/presence",
            // "/restapi/v1.0/account/~/extension/~/telephony/sessions",
            // "/restapi/v1.0/account/~/extension/~/presence",
            // "/restapi/v1.0/account/~/extension/~/presence/line/presence",
            // "/restapi/v1.0/account/~/extension/~/presence/line",
        ],
        deliveryMode: {
            transportType: "WebHook",
            address: process.env.RINGCENTRAL_WEBHOOK_DELIVERY_ADDRESS
        },
        expiresIn: 3600 * 24 * 365
    }
    try {
        let endpoint = "/restapi/v1.0/subscription"
        var resp = await platform.post(endpoint, bodyParams)
        var jsonObj = await resp.json()
        console.log(`Subscription Id: ${jsonObj.id}`)
        console.log("Ready to receive incoming SMS via WebHook.")
    } catch (e) {
        console.log({ e, msg: e.message })
    }
}

/* Read all created subscriptions */
async function read_subscriptions() {
    try {
        let endpoint = "/restapi/v1.0/subscription"
        var resp = await platform.get(endpoint)
        var jsonObj = await resp.json()
        console.log("RESPONSE >>>", jsonObj)
        if (jsonObj.records.length == 0) {
            console.log("No subscription yet.")
            console.log("Now subscribing for SMS events.")
            subscribe_for_notification()
        } else {
            for (var record of jsonObj.records) {
                // console.log({ record })
                delete_subscription(record.id)
            }
        }
    } catch (e) {
        console.error(e.message)
    }
}

/* Read SMS subscription events (TRYING) */
// async function read_SMS_subscriptions(uri) {
//     try {
//         let endpoint = uri
//         var resp = await platform.get(endpoint)
//         var jsonObj = await resp.json()
//         console.log("SMS EVENT webhook RESPONSE >>>", jsonObj)
//     } catch (e) {
//         console.error(e.message)
//     }
// }

/* Delete a subscription identified by the subscription id */
async function delete_subscription(subscriptionId) {
    try {
        let endpoint = `/restapi/v1.0/subscription/${subscriptionId}`
        var resp = await platform.delete(endpoint)
        console.log(`Subscription ${subscriptionId} deleted.`)
    } catch (e) {
        console.log(e.message)
    }
}

server.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`)
})
