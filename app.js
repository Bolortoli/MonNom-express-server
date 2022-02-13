dotenv.config();

import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import faker from 'faker';
import moment from 'moment';
import randToken from 'rand-token';
import randomatic from 'randomatic';
import jwt from 'express-jwt';
import helmet from 'helmet';
import compression from 'compression';
import legacyPublicRoutes from './routes/legacyPublicRoutes.js';
import legacyPrivateRoutes from './routes/legacyPrivateRoutes.js';


const app = express();
const port = process.env.PORT || 3000;

const STRAPI_URL = "https://strapi.monnom.mn";
const EXPRESS_URL = 'https://express.monnom.mn';
// const STRAPI_URL = "http://localhost:1337";
// const EXPRESS_URL = 'http://localhost:3000';

// For OTP
const SKYTEL_TOKEN = "443d503255559117690576e36f84ffe896f3f693";

// For payment
const QPAY_MERCHANT_USERNAME = "HAN_AQUA";
const QPAY_MERCHANT_PASSWORD = "UOaod0R9";
const QPAY_MERCHANT_INVOICE_NAME = "HANAQUA_INVOICE";
const QPAY_BASE_URL = "https://merchant.qpay.mn/v2";
const QPAY_MERCHANT = "https://merchant.qpay.mn/v2/invoice";
const QPAY_MERCHANT_AUTHENTICATION = "https://merchant.qpay.mn/v2/auth/token";

// Book payment types
const PAYMENT_EBOOK_MAGIC_WORD = "ebook";
const PAYMENT_AUDIO_BOOK_MAGIC_WORD = "audio-book";
const PAYMENT_BOOK_MAGIC_WORD = "book";

const PASSWORD_RESET_VALID_MINUTES = 1;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(compression())
app.use(helmet())

const fileStorageEngine = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, "./uploads");
	},
	filename: (req, file, cb) => {
		cb(null, `${file.originalname}`);
	},
});

const resolveURL = (url) => {
	return (url || "").startsWith("/") ? `${STRAPI_URL}${url}` : url;
};

const fakeEmail = () => {
	return `guest${create_temp_unique_text('xxxxxxxxxxxxx')}@monnomguest.com`;
}

const upload = multer({ storage: fileStorageEngine });

// temp user
const createTempUser = async () => {
	const email = fakeEmail();
	const username = `Temp ${faker.name.lastName()}`;
	const password = faker.internet.password();
	const userCreateResponse = await axios.post(`${STRAPI_URL}/auth/local/register`, {
		username,
		email,
		password
	});
	const user = userCreateResponse.data;
	return {
		user,
		delete: async () => {
			return axios.delete(`${STRAPI_URL}/users/${user.user.id}`, {
				headers: {
					Authorization: `${user.jwt}`
				}
			});
		}
	}
}

// guest
const createGuest = async ({ fcm_token }) => {
	const email = fakeEmail();
	const username = email;
	const password = faker.internet.password();
	const fullname = `Guest ${faker.name.lastName()}`;

	const createResponse = await axios.post(`${STRAPI_URL}/auth/local/register`, {
		username,
		email,
		fullname,
		password,
		is_guest: true,
		fcm_token,
		birthday: moment('2000-01-01 00:00:00').format('YYYY-MM-DD HH:mm:ss'),
		gender: 'Male',
		phone: faker.phone.phoneNumber()
	});
	const user = createResponse.data;
	return user;
}

// get qpay client
async function getQpayClient(){
	try{
		const qpayAuthResponse = await axios({ method: "POST", url: QPAY_MERCHANT_AUTHENTICATION, auth: { username: QPAY_MERCHANT_USERNAME, password: QPAY_MERCHANT_PASSWORD } });
		const qpayClient = axios.create({
			baseURL: QPAY_BASE_URL,
			headers: {
				Authorization: `Bearer ${qpayAuthResponse.data.access_token}`
			}
		});
		return qpayClient
	}catch(e){
		console.log(e);
		throw "QPAY authorization failed";
	}
}

// PUBLIC ENDPOINTS
app.post("/admin-login", async (req, res) => {
	console.log(req.body);
	await axios
		.post(`${STRAPI_URL}/auth/local`, { identifier: req.body.identifier, password: req.body.password }, { Authorization: `${req.headers.authorization}` })
		.then((response) => {
			send200(response.data, res);
		})
		.catch((err) => {
			console.log(err)
			send400("error", res);
		});
});

app.post('/app/guest/signup', async (req, res) => {
	try {
		const guest = await createGuest({ fcm_token: req.body?.fcm_token });
		send200(guest, res);
	} catch (e) {
		console.log(e);
		send400('Error creating guest', res);
	}
});

// Check if phone number can be username, then create confirmation code and send sms
app.post("/create-confirmation-code", async (req, res) => {
	try {
		let confirmationCode = create_temp_unique_text("xxxxxx");
		let users = await axios({
			url: `${STRAPI_URL}/users?username=${req.body.phone}`,
			method: "GET",
		}).catch((err) => {
			throw "failed to filter users";
		});

		if (users.data.length != 0) throw "Phone exists";

		await axios({
			url: `http://web2sms.skytel.mn/apiSend?token=${SKYTEL_TOKEN}&sendto=${req.body.phone}&message=Mon Nom confirmation code:%20 ${confirmationCode}`,
			method: "GET",
		}).catch((err) => {
			throw "Failed to send message";
		});

		send200({ confirmationCode, phone: req.body.phone }, res);
	} catch (error) {
		send400("error", res);
	}
});

app.post("/app/check-email", async (req, res) => {
	try {
		let users = await axios({
			url: `${STRAPI_URL}/users?email=${req.body.email}`,
			method: "GET",
		}).catch((err) => {
			throw "failed to filter users";
		});

		if (users.data.length != 0) throw "Email exists";

		send200({}, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get("/payment/payment-callback/:invoice_id/:payment_collection_name/:delivery_id?", async (req, res, next) => {

	// callback validation
	if (['customer-paid-books', 'customer-paid-ebooks', 'customer-paid-audio-books'].indexOf(req.params.payment_collection_name) == -1) {
		send400({ error: "Wrong Collection" }, res);
		return;
	}

	try {
		const tempAuthResponse = await axios({
			url: `${STRAPI_URL}/auth/local`,
			method: 'POST',
			data: {
				identifier: 'qpaytempuser@qpaytempuser.com',
				password: 'qpaytempuser'
			}
		})
		const tempAuthJwt = tempAuthResponse.data.jwt;
		const apiClient = axios.create({
			baseURL: STRAPI_URL,
			headers: {
				Authorization: `Bearer ${tempAuthJwt}`,
			},
		});
		const invoice_id = req.params.invoice_id;
		let paymentResponse = await apiClient.get(`/payments?invoice_id=${invoice_id}`).catch((err) => {
			console.log(err)
			throw "Fetching payment failed";
		});

		paymentResponse = paymentResponse.data[0];

		// check qpay payment
		const qpayInvoiceId = paymentResponse.qpay_invoice_id
		const qpayClient = await getQpayClient();
		const qpayPaymentCheckResponse = await qpayClient.post('/payment/check', {
			"object_type": "INVOICE",
			"object_id"  : qpayInvoiceId
		})
		const paidRow = qpayPaymentCheckResponse.data.rows.find((row) => row.payment_status === 'PAID');
		const isPaid = paidRow != undefined;
		const paidAmount = qpayPaymentCheckResponse.data.paid_amount
		let paymentUpdateResponse;
		try {
			paymentUpdateResponse = await apiClient.put(`/payments/${paymentResponse.id}`, {
				is_approved: isPaid,
				paid_amount: paidAmount,
				payment_data: JSON.stringify(req.body || {}) + "get",
			});
		} catch (e) {
			throw "Payment update failed";
		}
		
		// check payment before grant book
		if (!isPaid){
			send400('NOT_PAID', res);
			return;
		}
		console.log('paid');

		// give permission to user
		paymentUpdateResponse = paymentUpdateResponse.data;
		const bookPaymentResponse = await apiClient
			.post(`/${req.params.payment_collection_name}`, {
				book: paymentUpdateResponse.book.id,
				users_permissions_user: paymentUpdateResponse.users_permissions_user.id,
				payment: paymentUpdateResponse.id,
			})
			.catch((err) => {
				throw "Failed to save on collection name";
			});

		// update delivery
		if (parseInt(req.params.delivery_id)) {
			try {
				await apiClient.put(`/delivery-registrations/${req.params.delivery_id}`, {
					is_paid: true,
					customer_paid_book: bookPaymentResponse.data.id
				});
			} catch (e) {
				console.log('Delivery put failed');
			}
		} else {
			console.log('no delivery')
			console.log(req.params.delivery_id)
		}

		// send notification
		const userResponse = await apiClient.get(`/users?id=${paymentUpdateResponse.users_permissions_user.id}`);
		const user = userResponse.data[0];
		const fcmToken = user?.fcm_token;
		await axios({
			url: "https://fcm.googleapis.com/fcm/send",
			method: "POST",
			headers: { Authorization: `key=${process.env.FCM_SERVER_KEY}` },
			data: {
				registration_ids: [fcmToken],
				channel_id: "notifee_channel1",
				notification: { title: "Төлбөр амжилттай", body: "" },
				data: {
					title: "Төлбөр амжилттай",
					body: "",
					book_id: paymentUpdateResponse.book.id,
					type: "book_payment",
					content_available: true
				},
				android: {
					"priority": "HIGH"
				},

			},
		}).catch((err) => {
			console.log('notification error');
			console.log(err);
			throw "Failed to send notification";
		});
		send200(paymentUpdateResponse, res);
	} catch (e) {
		console.log(e);
		send400(e, res);
	}
});

app.use(legacyPublicRoutes)

// Create customer
app.post("/app/create-user", async (req, res) => {
	axios({
		url: `${STRAPI_URL}/users`,
		method: "POST",
		data: {
			username: req.body.phoneNumber,
			phone: req.body.phoneNumber,
			password: req.body.password,
			email: req.body.email,
			gender: req.body.gender,
			birthday: req.body.birthday,
			fullname: req.body.fullName,
			user_role: 6,
		},
	})
		.then((response) => {
			axios
				.post(`${STRAPI_URL}/auth/local`, {
					identifier: req.body.phoneNumber,
					password: req.body.password,
				})
				.then((response) => {
					send200(response.data, res);
				})
				.catch((err) => {
					console.log("2nd");
					console.log(err)
					throw "error";
				});
		})
		.catch((err) => {
			console.log(err);
			console.log("1st");
			send400("error", res);
		});
});

// send password reset url
app.post('/user/forgot-password', async (req, res) => {
	const tempUser = await createTempUser();
	try {
		const { username } = req.body;
		const apiClient = axios.create({
			baseURL: STRAPI_URL,
			headers: {
				Authorization: `${tempUser.user.jwt}`
			}
		});
		const userToResetPwdResponse = await apiClient.get(`/users?username=${username}&_limit=1`);
		if (!userToResetPwdResponse.data.length) {
			throw 'no user found'
		} else {
			const user = userToResetPwdResponse.data[0];
			const resetPasswordCode = randomatic('0', 6); // n random digits
			const codeSentAt = moment.utc().format('YYYY-MM-DD HH:mm:ss');
			const resetPasswordCodeResponse = await apiClient.put(`/users/${user.id}`, {
				resetPasswordCode,
				resetPasswordToken: null,
				resetPasswordTokenIssuedAt: codeSentAt
			});
			await axios({
				url: `http://web2sms.skytel.mn/apiSend?token=${SKYTEL_TOKEN}&sendto=${user.phone}&message=Monnom: tanii neg udaagiin nuuts kod: ${resetPasswordCode}`,
				method: "GET",
			})
			send200({
				codeSentAt,
				minutes: PASSWORD_RESET_VALID_MINUTES,
				// resetPasswordCode
			}, res);
		}
	} catch (e) {
		console.log(e);
		send400(e, res)
	}
	await tempUser.delete();
});

// confirm one time password
app.post('/user/forgot-password/confirm', async (req, res) => {
	const tempUser = await createTempUser();
	try {
		const { username, code } = req.body;
		if (!(username || '').length || !(code || '').length) {
			throw 'Код буруу байна';
		}
		const apiClient = axios.create({
			baseURL: STRAPI_URL,
			headers: {
				Authorization: `${tempUser.user.jwt}`
			}
		});
		const usersResponse = (await apiClient.get(`/users?username=${username}&resetPasswordCode=${code}&_limit=1`));
		if (!usersResponse.data.length) {
			throw 'Код буруу байна';
		}

		const user = usersResponse.data[0];
		// хугацаа шалгах
		const now = moment.utc();
		const due = moment(user.resetPasswordTokenIssuedAt);
		const delta = moment.duration(now.diff(due));
		if (delta.asMinutes() > PASSWORD_RESET_VALID_MINUTES) {
			throw 'Кодын хүчинтэй хугацаа дууссан байна';
		}
		const resetPasswordToken = randToken.generate(32);
		await apiClient.put(`/users/${user.id}`, {
			resetPasswordToken,
			resetPasswordCode: null,
			resetPasswordTokenIssuedAt: moment.utc().format('YYYY-MM-DD HH:mm:ss')
		})
		if (user) {
			send200({ token: resetPasswordToken }, res);
		}
	} catch (e) {
		console.log(e);
		send400(e, res);
	}
	await tempUser.delete();
});

// password reset callback
app.post('/user/forgot-password/reset', async (req, res) => {
	const tempUser = await createTempUser();
	try {
		const { token, username, password } = req.body;
		if (!token || !username || !password) {
			send400('Мэдээлэл дутуу', res);
			return
		}
		if ((password || '').length < 4) {
			send400('3 -с олон тэмдэгт ашиглана уу', res);
			return
		}
		const apiClient = axios.create({
			baseURL: STRAPI_URL,
			headers: {
				Authorization: `${tempUser.user.jwt}`
			}
		});

		const userResponse = await apiClient.get(`/users?resetPasswordToken=${token}&username=${username}`);
		const user = userResponse.data.length ? userResponse.data[0] : null;
		if (!user?.id) {
			throw 'invalid token';
		}
		// code validated successfully

		// update password and cleanup
		const userUpdateResponse = await apiClient.put(`/users/${user.id}`, {
			password,
			resetPasswordToken: null,
			resetPasswordTokenIssuedAt: null
		})
		res.send(userUpdateResponse.data);
	} catch (e) {
		console.log(e);
		send400(e, res);
	}
	await tempUser.delete();
});

// PRIVATE ENDPOINTS

// app version compatibility
app.use((req, res, next) => {
	if (!req.headers.authorization?.toString().startsWith('Bearer')) {
		req.headers.authorization = `Bearer ${req.headers.authorization}`
	}
	next();
})

app.use(jwt({ secret: process.env.JWT_SECRET, algorithms: ['HS256'] }));

// ----------------------------- PAYEMNT APIs -----------------------------

app.post("/payment/create-invoice/:payment_type", async (req, res, next) => {
	try {
		let model_name;

		switch (req.params.payment_type) {
			case PAYMENT_EBOOK_MAGIC_WORD:
				model_name = "customer-paid-ebooks";
				break;
			case PAYMENT_AUDIO_BOOK_MAGIC_WORD:
				model_name = "customer-paid-audio-books";
				break;

			case PAYMENT_BOOK_MAGIC_WORD:
				model_name = "customer-paid-books";
				break;
			default:
				throw "Magic word not founds";
		}

		let tempInvoiceId = create_temp_unique_text("xxxxxx-xxxxxx");

		const config = {
			Authorization: `${req.headers.authorization}`
		}

		// Get QPAY access token
		let qpay_access = await axios({ method: "POST", url: QPAY_MERCHANT_AUTHENTICATION, auth: { username: QPAY_MERCHANT_USERNAME, password: QPAY_MERCHANT_PASSWORD } }).catch((err) => {
			throw "QPAY authorization failed";
		});

		// For get book price
		let book = await axios({ method: "GET", url: `${STRAPI_URL}/books/${req.body.book_id}`, headers: config}).catch((err) => {
			throw "Fetch book failed";
		});

		// get user data
		let user = await axios({ method: "GET", url: `${STRAPI_URL}/users/${req.user.id}`, headers: config}).catch((err) => {
			throw "Fetch user failed";
		});
		user = user.data;

		qpay_access = qpay_access.data;
		book = book.data;
		let delivery;
		if (req.params.payment_type === 'book') {
			const deliveryCreateResponse = await axios({
				url: `${STRAPI_URL}/delivery-registrations`,
				method: 'POST',
				data: {
					order_destination: req.body.order_destination,
					customer: req.body.user_id,
					is_paid: false,
					is_delivered: false,
				},
				headers: {
					Authorization: `${req.headers.authorization}`
				}
			});
			delivery = deliveryCreateResponse.data;
		}

		let callback_url = `${EXPRESS_URL}/payment/payment-callback/${tempInvoiceId}/${model_name}/${delivery?.id || 0}`
		let paymentDescription = `Monnom - ${req.body.book_name} ${user.username}`
		let data = {
			invoice_code: QPAY_MERCHANT_INVOICE_NAME,
			sender_invoice_no: tempInvoiceId,
			invoice_receiver_code: req.body.user_id.toString(),
			invoice_description: paymentDescription,
			amount: null,
			callback_url,
		};
		switch (req.params.payment_type) {
			case PAYMENT_EBOOK_MAGIC_WORD:
				data.amount = book.online_book_price;
				break;
			case PAYMENT_AUDIO_BOOK_MAGIC_WORD:
				data.amount = book.audio_book_price;
				break;

			case PAYMENT_BOOK_MAGIC_WORD:
				data.amount = book.book_price;
				break;
			default:
				throw "Magic word not founds";
		}

		const usedPromos = (await axios({
			url: `${STRAPI_URL}/users-promo-codes`,
			method: 'GET',
			params: {
				user: req.user.id,
				book: req.body.book_id,
				_limit: 1,
				_sort: 'id:desc'
			},
			headers: config
		})).data
		if (usedPromos?.length) {
			const promoProduct = (await axios({
				url: `${STRAPI_URL}/promo-code-products/${usedPromos[0].promo_code.product}`,
				method: 'GET',
				headers: config
			})).data
			const discount = promoProduct.discount_percent
			data.amount = data.amount - (data.amount * discount / 100)
		}

		let qpay_invoice_creation = await axios({
			method: "POST",
			url: QPAY_MERCHANT,
			headers: {
				Authorization: `Bearer ${qpay_access.access_token}`,
			},
			data,
		}).catch((err) => {
			console.log(err.response.data);
			throw "Invoice creation failed";
		});

		const paymenCreatePayload = {
			users_permissions_user: req.body.user_id,
			payment_amount: data.amount,
			is_approved: false,
			book_payment_type: req.params.payment_type,
			description: paymentDescription,
			book: req.body.book_id,
			invoice_id: tempInvoiceId,
			callback_url
		}
		const paymentCreateResponse = await axios({
			method: "POST",
			url: `${STRAPI_URL}/payments`,
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
			data: paymenCreatePayload,
		}).catch(() => {
			throw "Save payment failed";
		});

		// save qpay invoice id
		const paymentId = paymentCreateResponse.data.id;
		const qpayInvoiceId = qpay_invoice_creation.data.invoice_id;
		
		await axios({
			url: `${STRAPI_URL}/payments/${paymentId}`,
			method: 'PUT',
			data: {
				qpay_invoice_id: qpayInvoiceId
			},
			headers: {
				Authorization: `${req.headers.authorization}`
			}
		})

		// hide invoice_id from client so that they can't hack it
		let response_data = { ...qpay_invoice_creation.data };
		delete response_data["invoice_id"];
		send200(response_data, res);
	} catch (error) {
		console.log("err");
		console.log(error);
		send400(error, res);
	}
});

app.get("/test", async (req, res) => {
	res.send("test workflow");
});

// ----------------------------- PAYEMNT APIs -----------------------------

// ----------------------------- WEBSITE APIs -----------------------------

// Statistics about dashboard
app.get("/dashboard", async (req, res) => {
	try {

		const config = {
			Authorization: req.headers.authorization
		}
		let responseData = {
			totalPodcastChannels: 0,
			totalPodcastFollows: 0,
			totalRadioChannels: 0,
			totalAudioBooks: 0,
			totalEBooks: 0,
			totalBooks: 0,
			usersByGender: { maleCount: 0, femaleCount: 0, othersCount: 0 },
			usersByAge: { category18: 0, category18_28: 0, category28_38: 0, category38_48: 0, category48_58: 0, category58: 0 },
			mostFollowedPodcastChannels: [],
			mostBoughtBooks: [],
			mostBoughtAudioBooks: [],
			mostBoughtPDFBooks: [],
		};

		let customer_saved_books = await axios({ url: `${STRAPI_URL}/customer-paid-books`, method: "GET", headers: config}).catch((err) => {
			throw "error saved books";
		});

		let customer_saved_ebooks = await axios({ url: `${STRAPI_URL}/customer-paid-ebooks`, method: "GET", headers: config}).catch((err) => {
			throw "error saved ebooks";
		});

		let podcast_channels = await axios({ url: `${STRAPI_URL}/podcast-channels`, method: "GET", headers: config}).catch((err) => {
			throw "error podcast channels";
		});

		let podcast_channels_saves = await axios({ url: `${STRAPI_URL}/user-saved-podcasts`, method: "GET", headers: config}).catch((err) => {
			throw "error saved podcasts";
		});

		let totalRadioChannels = await axios({ url: `${STRAPI_URL}/radio-channels/count`, method: "GET", headers: config}).catch((err) => {
			throw "error radio";
		});

		let books = await axios({ url: `${STRAPI_URL}/books`, method: "GET", headers: config}).catch((err) => {
			throw "error books";
		});

		let app_users = await axios({ url: `${STRAPI_URL}/users?user_role=6`, method: "GET", headers: config}).catch((err) => {
			throw "error users";
		});

		app_users = app_users.data;
		podcast_channels = podcast_channels.data;
		podcast_channels_saves = podcast_channels_saves.data;
		books = books.data;
		customer_saved_books = customer_saved_books.data;
		customer_saved_ebooks = customer_saved_ebooks.data;

		// ------------ MOST BOUGHT ONLINE BOOKS ------------
		let tempBooks = [];
		customer_saved_books.forEach((buy) => {
			let tempBook_loop = tempBooks.find((book) => book.id == buy.book?.id);
			if (tempBook_loop != undefined && tempBooks.length != 0) tempBook_loop.bought_count += 1;
			else tempBooks.push({ id: buy.book?.id, name: buy.book?.name, is_featured: buy.book?.is_featured ? "Тийм" : "Үгүй", bought_count: 1 });
		});

		tempBooks.sort(function (a, b) {
			return b.bought_count - a.bought_count;
		});
		// ------------ MOST BOUGHT ONLINE BOOKS ------------

		// ------------ MOST BOUGHT ONLINE BOOKS ------------
		let tempAudioBooks = [];
		let tempPDFBooks = [];
		customer_saved_ebooks.forEach((buy) => {
			let tempAudioBook_loop = tempAudioBooks.find((book) => book.id == buy.book?.id);
			let tempPDFBook_loop = tempPDFBooks.find((book) => book.id == buy.book?.id);
			// AUDIO COUNTS
			if (buy.book?.has_audio) {
				if (tempAudioBook_loop != undefined && tempAudioBooks.length != 0) tempAudioBook_loop.bought_count += 1;
				else tempAudioBooks.push({ id: buy.book?.id, name: buy.book?.name, is_featured: buy.book?.is_featured ? "Тийм" : "Үгүй", bought_count: 1 });
			}
			// PDF COUNTS
			if (buy.book?.has_pdf) {
				if (tempPDFBook_loop != undefined && tempPDFBooks.length != 0) tempPDFBook_loop.bought_count += 1;
				else tempPDFBooks.push({ id: buy.book?.id, name: buy.book?.name, is_featured: buy.book?.is_featured ? "Тийм" : "Үгүй", bought_count: 1 });
			}
		});

		tempAudioBooks.sort(function (a, b) {
			return b.bought_count - a.bought_count;
		});

		tempPDFBooks.sort(function (a, b) {
			return b.bought_count - a.bought_count;
		});
		// ------------ MOST BOUGHT ONLINE BOOKS ------------

		// ------------ APP USERS BY GENDER AND AGE ------------
		app_users.forEach((user) => {
			if (user.gender == "Male") responseData.usersByGender.maleCount += 1;
			if (user.gender == "Female") responseData.usersByGender.femaleCount += 1;
			if (user.gender == "Others") responseData.usersByGender.othersCount += 1;

			if (user.birthday != null) {
				let user_age = getAge(user.birthday);
				if (user_age < 18) responseData.usersByAge.category18 += 1;
				if (user_age < 28 && user_age >= 18) responseData.usersByAge.category18_28 += 1;
				if (user_age < 38 && user_age >= 28) responseData.usersByAge.category28_38 += 1;
				if (user_age < 48 && user_age >= 38) responseData.usersByAge.category38_48 += 1;
				if (user_age < 58 && user_age >= 48) responseData.usersByAge.category48_58 += 1;
				if (user_age > 58) responseData.usersByAge.category58 += 1;
			}
		});
		// ------------ APP USERS BY GENDER AND AGE ------------

		// ------------ MOST SAVED PODCAST CHANNELS ------------
		let tempPodcastChannelsSaves = [];
		podcast_channels_saves.forEach((save) => {
			let tempPodcastChannel = tempPodcastChannelsSaves.find((channel) => channel.id == save.podcast_channel?.id);
			if (tempPodcastChannel != undefined && tempPodcastChannelsSaves.length != 0) tempPodcastChannel.saves_count += 1;
			else
				tempPodcastChannelsSaves.push({
					id: save.podcast_channel?.id,
					name: save.podcast_channel?.name,
					is_featured: save.podcast_channel?.is_featured ? "Тийм" : "Үгүй",
					saves_count: 1,
				});
		});

		tempPodcastChannelsSaves.sort(function (a, b) {
			return b.saves_count - a.saves_count;
		});
		// ------------ MOST SAVED PODCAST CHANNELS ------------

		// ------------ BOOKS COUNTER ------------
		books.forEach((book) => {
			if (book.has_audio) responseData.totalAudioBooks += 1;
			if (book.has_pdf) responseData.totalEBooks += 1;
			if (book.has_sale) responseData.totalBooks += 1;
		});
		// ------------ BOOKS COUNTER ------------

		responseData.totalPodcastChannels = podcast_channels.length;
		responseData.totalPodcastFollows = podcast_channels_saves.length;
		responseData.totalRadioChannels = totalRadioChannels.data;
		responseData.mostFollowedPodcastChannels = tempPodcastChannelsSaves;
		responseData.mostBoughtAudioBooks = tempAudioBooks;
		responseData.mostBoughtPDFBooks = tempPDFBooks;
		responseData.mostBoughtBooks = tempBooks;

		send200(responseData, res);
	} catch (error) {
		send400(JSON.stringify(error), res);
	}
});

app.get("/book-add-informations", async (req, res) => {
	try {
		const headers = {
			Authorization: req.headers.authorization
		}
		let sendData = { available_authors: null, available_categories: null };
		let authors = await axios({ method: "GET", url: `${STRAPI_URL}/book-authors`, headers}).catch((err) => {
			throw "error-authors";
		});
		let categories = await axios({ method: "GET", url: `${STRAPI_URL}/book-categories`, headers}).catch((err) => {
			throw "error-categpries";
		});

		sendData.available_categories = categories.data;
		sendData.available_authors = authors.data;

		send200(sendData, res);
	} catch (error) {
		send400(error, res);
	}
});

// Information about specific book author all books
app.get("/book-single-by-author/:id", async (req, res) => {
	const headers = { Authorization: `${req.headers.authorization}` };
	await axios({ url: `${STRAPI_URL}/users/${req.params.id}`, method: "GET", headers: headers })
		.then(async (response) => {
			// TODO user data
			let sendData = { user: { id: response.data.id, user_fullname: response.data.fullname, user_pic_url: response.data.profile_picture ? resolveURL(response.data.profile_picture?.url) : null, user_mail: response.data.email, user_joined_date: response.data.created_at, user_phone: response.data.phone }, user_books: null, available_authors: null, available_categories: null };
			await axios({ method: "GET", url: `${STRAPI_URL}/books?users_permissions_user.id=${req.params.id}`, headers: headers })
				.then(async (response) => {
					// console.log(response.data);
					sendData.user_books = response.data.map((book) => {
						return {
							id: book.id,
							book_pic_url: resolveURL(book.picture?.url),
							book_name: book.name,
							book_author: book.book_authors.map((author) => {
								return { id: author.id, name: author.author_name };
							}),
							book_category: book.book_categories.map((category) => {
								return { id: category.id, name: category.name };
							}),
							book_added_date: book.created_at,
							has_sale: book.has_sale,
							has_mp3: book.has_audio,
							has_pdf: book.has_pdf,
							book_desc: book.introduction,
							book_comments: book.book_comments,
							is_featured: book.is_featured,
							online_book_price: book.online_book_price,
							audio_book_price: book.audio_book_price,
							book_price: book.book_price,
							sale_quantity: book.sale_quantity,
							book_sales_count: 0,
							online_book_sales_count: 0,
						};
					});
					await axios({ method: "GET", url: `${STRAPI_URL}/book-authors`, headers: headers })
						.then(async (responseAuthors) => {
							sendData.available_authors = responseAuthors.data;
							await axios({ method: "GET", url: `${STRAPI_URL}/book-categories`, headers: headers })
								.then(async (responseCategories) => {
									sendData.available_categories = responseCategories.data;
									await axios({ method: "GET", url: `${STRAPI_URL}/customer-paid-books`, headers: headers })
										.then((responsePayments) => {
											sendData.user_books.forEach((book) => (book.book_sales_count = responsePayments.data.filter((payment) => book.id == payment.book?.id).length));
										})
										.catch((err) => {
											throw "broken1";
										});
									await axios({ method: "GET", url: `${STRAPI_URL}/customer-paid-ebooks`, headers: headers })
										.then((responsePayments) => {
											sendData.user_books.forEach((book) => (book.online_book_sales_count = responsePayments.data.filter((payment) => book.id == payment.book?.id).length));
										})
										.catch((err) => {
											throw "broken2";
										});
								})
								.catch((err) => {
									throw err + "broken3";
								});
						})
						.catch((err) => {
							throw err + "broken4";
						});

					res.send(sendData);
				})
				.catch((err) => {
					throw err + "broken5";
				});
		})
		.catch((err) => {
			send400(err, res);
		});
});

// Information about specific podcast channel
app.get("/podcast-channels/:id", async (req, res) => {
	await axios({
		url: `${STRAPI_URL}/podcast-channels/${req.params.id}`,
		method: "GET",
		headers: {
			Authorization: `${req.headers.authorization}`,
		},
	})
		.then((response) => {
			console.log("got fcken success");
			console.log(response.data);
			let sendData = {
				id: response.data.id,
				user_fullname: response.data.users_permissions_user?.fullname,
				channel_name: response.data.name,
				channel_created_at: response.data.created_at,
				channel_updated_at: response.data.updated_at,
				channel_description: response.data.description,
				channel_cover_pic: response.data.cover_pic != null ? resolveURL(response.data.cover_pic.url) : null,
				user_podcasts: response.data.podcast_episodes.map((d) => {
					return {
						id: d.id,
						podcast_name: d.episode_name,
						podcast_file_name: d.audio_file_path ? d.audio_file_path.name : null,
						podcast_file_size: d.audio_file_path ? d.audio_file_path.size : null,
						podcast_desc: d.episode_description,
						episode_number: d.episode_number,
						podcast_added_date: d.create_at,
						listen_count: d.view_count,
					};
				}),
			};
			res.send(sendData);
		})
		.catch((err) => {
			console.log(err);
			res.status(400).send({ response: "error" });
		});
	// res.send(req.params.id);
});

// Delete podcast episode
app.delete("/podcast/:id", async (req, res) => {
	axios
		.delete(`${STRAPI_URL}/podcast-episodes/${req.params.id}`, {
			headers: {
				Authorization: `${req.headers.authorization}`,
			}
		})
		.then((response) => {
			console.log(response.data);
			res.status(202).send({ message: "success" });
		})
		.catch((err) => {
			console.log(err);
			res.status(400).send({ message: "error" });
		});
});

// Create podcast episode
app.post("/podcast", upload.single("podcast_episode"), async (req, res) => {
	await axios
		.post(`${STRAPI_URL}/podcast-episodes`, formData, { Authorization: `${req.headers.authorization}` })
		.then(async (res) => {
			let tempResponse = res.data;
			let imageData = new FormData();

			imageData.append(`files`, profile_picture_create);

			imageData.append("refId", res.data.id);
			imageData.append("ref", "user");
			imageData.append("field", "profile_picture");
			imageData.append("source", "users-permissions");

			await axios
				.post("${STRAPI_URL}/upload", imageData, { Authorization: `${req.headers.authorization}` })
				.then((res) => {
					tempResponse.profile_picture = res.data[0];
				})
				.catch((err) => {
					send400("");
				});
		})
		.catch((err) => {
			send400("error", res);
		});
});

// Create admin
app.post("/create-admin", upload.single("profile_picture"), async (req, res, next) => {
	await axios({
		url: `${STRAPI_URL}/users`,
		method: "POST",
		headers: { "content-type": "multipart/form-data", Authorization: `${req.headers.authorization}` },
		body: { username: req.body.username, password: req.body.password, role: 1, phone: req.body.phone, gender: req.body.gender, fullname: req.body.fullname, user_role: req.body.user_role, e_mail: req.body.emailof, email: req.body.emailof },
	})
		.then((response) => {
			send200(response.data, res);
		})
		.catch((err) => {
			send400(err.response.data, res);
		});
});

// Update terms and conditions
app.put("/terms-and-conditions", upload.single("profile_picture"), async (req, res) => {
	await axios({
		url: `${STRAPI_URL}/settings`,
		method: "PUT",
		headers: {
			Authorization: `${req.headers.authorization}`,
		},
		data: {
			TermsAndConditions: req.body.terms,
		},
	})
		.then((response) => {
			send200(response.data, res);
			// res.send(response.data);
		})
		.catch((err) => {
			console.log(err);
			send400("error", res);
		});
});

// Login

app.get("/settings-page", async (req, res) => {
	try {
		let settings = await axios({
			url: `${STRAPI_URL}/settings`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error";
		});

		let podcast_categories = await axios({
			url: `${STRAPI_URL}/podcast-categories`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let book_categories = await axios({
			url: `${STRAPI_URL}/book-categories`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error2";
		});

		let book_authors = await axios({
			url: `${STRAPI_URL}/book-authors`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error3";
		});

		settings = settings.data;
		podcast_categories = podcast_categories.data;
		book_categories = book_categories.data;
		book_authors = book_authors.data;

		let data = {
			termsAndConditions: settings.TermsAndConditions,
			podcast_categories: podcast_categories.map((category) => {
				return {
					value: category.id,
					label: category.name,
				};
			}),
			book_categories: book_categories.map((category) => {
				return {
					value: category.id,
					label: category.name,
				};
			}),
			book_authors: book_authors.map((author) => {
				return {
					value: author.id,
					label: author.author_name,
				};
			}),
		};

		send200(data, res);
	} catch (error) {
		send400(error, res);
	}
});

// List of employees
app.get("/all-admins-list", (req, res) => {
	// console.log(req);
	const headers = {
		Authorization: req.headers.authorization
	}
	axios({ url: `${STRAPI_URL}/users?user_role=1&user_role=2&user_role=3&user_role=4&user_role=5`, method: "GET", headers })
		.then((response) => {
			console.log(response.data.map((d) => d.user_role));
			send200(response.data, res);
		})
		.catch((err) => {
			console.log(err);
			send400("error", res);
		});
});

// List of employees who are don't have podcast channel
app.get("/all-admins-settings", async (req, res) => {
	const headers = {
		Authorization: req.headers.authorization
	}
	// console.log(req);
	await axios({ url: `${STRAPI_URL}/users?podcast_channel_null=true`, method: "GET", headers})
		.then((response) => {
			let sendData = response.data.filter((data) => data.user_role == 1 || data.user_role == 2 || data.user_role == 3 || data.user_role == 4 || data.user_role == 5);
			send200(sendData, res);
		})
		.catch((err) => {
			console.log(err);
			send400("error", res);
		});
});

// Update employee information
app.post("/update-employee", async (req, res) => {
	// console.log(req);
	let id = req.body.id;
	let body = Object.assign(req.body);
	delete body["id"];
	await axios({
		headers: {
			Authorization: `${req.headers.authorization}`,
		},
		url: `${STRAPI_URL}/users/${id}`,
		method: "PUT",
		data: body,
	})
		.then((response) => {
			send200(response.data, res);
		})
		.catch((err) => {
			console.log(err);
			send400("error", res);
		});
});

// List of podcast channels
app.get("/podcast-channels", async (req, res) => {
	await axios({
		headers: {
			Authorization: `${req.headers.authorization}`,
		},
		url: `${STRAPI_URL}/podcast-channels`,
		method: "GET",
	})
		.then((response) => {
			let sendData = {
				podcastChannels: response.data
					.map((data, index) => {
						console.log(data);
						return {
							id: data.id,
							pagination_number: index + 1,
							is_featured: data.is_featured,
							podcast_author: {
								id: data.users_permissions_user?.id,
								firstname: data.users_permissions_user?.fullname,
							},
							podcast_name: data.name,
							podcast_pic_url: resolveURL(data.cover_pic?.url),
							episode_count: data.podcast_eposides?.length,
							podcast_added_date: data.created_at,
							channel_categories: data.podcast_categories,
						};
						// else return null;
					})
					.filter((data) => data)
					.sort((channel1, channel2) => (channel1.is_featured === channel2.is_featured ? 0 : channel1.is_featured ? -1 : 1)),
			};
			send200(sendData, res);
		})
		.catch((err) => {
			console.log(err);
			send400("error", res);
		});
});

// List of app users
app.get("/all-app-users", async (req, res) => {
	await axios({
		url: `${STRAPI_URL}/users?user_role=6&_limit=1000000000`,
		method: "GET",
		headers: {
			Authorization: `${req.headers.authorization}`,
		},
	})
		.then((response) => {
			send200(response.data, res);
		})
		.catch((err) => {
			send400("error", res);
		});
});

// List of books
app.get("/all-books-list", async (req, res) => {
	try {
		let tempResponse = {
			books: [],
			authors: [],
			categories: [],
		};
		let books = await axios({
			url: `${STRAPI_URL}/books`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error";
		});

		books = books.data;

		tempResponse.books = books
			.map((book, index) => {
				console.log(book);

				if (book.users_permissions_user != null)
					return {
						user_id: book.users_permissions_user?.id,
						id: book.id,
						book_pic_url: resolveURL(book.picture?.url),
						book_author_name: book.book_authors.map((author) => {
							return author.author_name;
						}),
						book_added_date: book.created_at,
						book_name: book.name,
						has_mp3: book.has_audio,
						has_pdf: book.has_pdf,
						has_sale: book.has_sale,
						is_featured: book.is_featured,
						pagination_number: index + 1,
					};
			})
			.sort((book1, book2) => (book1.is_featured === book2.is_featured ? 0 : book1.is_featured ? -1 : 1));

		send200(tempResponse.books, res);
	} catch (error) {
		send400("error", res);
	}
});

// ----------------------------- APP APIs -----------------------------

// guest login
// app.post('/app/guest/login', async (req, res) => {

// });

// Unsave podcast channel
app.post("/app/unsave-podcast-channel", async (req, res, next) => {
	try {
		console.log("unsave podcast channel");
		let saves = [];
		let saved_podcasts = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?podcast_channel.id=${req.body.channel_id}&users_permissions_user=${req.body.user_id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error";
		});
		saved_podcasts = saved_podcasts.data;

		saved_podcasts.forEach((podcast) => {
			saves.push(`${STRAPI_URL}/user-saved-podcasts/${podcast.id}`);
		});

		console.log(saves);
		const [resp] = await Promise.all(saves.map((podcastRequest) => axios.delete(podcastRequest, {})));
		send200({}, res);
	} catch (error) {
		send400("error", res);
	}
});

app.post("/app/unsave-book", async (req, res, next) => {
	try {
		console.log("unsave podcast channel");
		let saves = [];
		let saved_podcasts = await axios({
			url: `${STRAPI_URL}/user-saved-books?users_permissions_user=${req.body.user_id}&book.id=${req.body.book_id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error";
		});
		saved_podcasts = saved_podcasts.data;

		saved_podcasts.forEach((podcast) => {
			saves.push(`${STRAPI_URL}/user-saved-books/${podcast.id}`);
		});

		console.log(saves);
		const [resp] = await Promise.all(
			saves.map((podcastRequest) =>
				axios.delete(podcastRequest, {
					headers: {
						Authorization: `${req.headers.authorization}`,
					},
				})
			)
		);
		send200({}, res);
	} catch (error) {
		send400("error", res);
	}
});

// all channels list
app.get("/app/live", async (req, res, next) => {
	// try {
	console.log(req.headers);
	let responseData = {
		channelsList: [],
	};

	let channel = await axios({
		url: `${STRAPI_URL}/radio-channels`,
		method: "GET",
		headers: {
			Authorization: `${req.headers.authorization}`,
		},
	}).catch((err) => {
		console.log(err);
		throw "error fetch data";
	});

	channel = channel.data;

	channel.forEach((c) => {
		console.log(c);
		if (c.is_active && c.radio_channel_audios.length != 0)
			responseData.channelsList.push({
				id: c.id,
				name: c.name,
			});
	});

	send200(responseData, res);
	// } catch (error) {
	// 	send400(error, res);
	// }
});

// Radio channel single
app.get("/app/live/:channel_id", async (req, res, next) => {
	try {
		let responseData = {
			episode_id: null,
			current_second: null,
			episodes: [],
		};

		let channel = await axios({
			url: `${STRAPI_URL}/radio-channels/${req.params.channel_id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			console.log(err);
			throw "failed to fetch radio channel";
		});

		channel = channel.data;
		let channel_audio = channel.radio_channel_audios;

		channel_audio.sort(function (a, b) {
			return b.stack_number - a.stack_number;
		});

		// ------------ GET TOTAL RADIO AUDIOS SECONDS ------------
		let totalDuration = 0;
		channel_audio.forEach((audio) => {
			totalDuration += parseInt(audio.audio_duration);
		});

		// ------------ GET DIFFERENCE OF TODAY AND LAST UPDATED SECONDS in ms ------------
		let differce = parseInt((new Date().getTime() - new Date(channel.updated_at).getTime()) / 1000);

		// ------------ CONVERT SECONDS TO TOTAL DURATION MODULO ------------
		differce %= totalDuration;
		// console.log("differce");
		// console.log(differce);

		// ------------ FIND CURRENT MP3 FILE PATH ------------
		try {
			channel_audio.forEach((audio) => {
				// console.log(audio.id);

				if (differce < parseInt(audio.audio_duration)) {
					responseData.current_second = parseInt(audio.audio_duration) - (parseInt(audio.audio_duration) - differce);
					responseData.episode_id = audio.id;
					throw "break";
				} else {
					differce -= parseInt(audio.audio_duration);
				}
			});
		} catch (error) { }

		responseData.episodes = channel_audio.map((episode) => {
			return {
				id: episode.id,
				mp3_file_path: resolveURL(episode.audio?.url),
				duration: episode.audio_duration,
				stack: episode.stack_number,
			};
		});

		send200(responseData, res);
	} catch (error) {
		send400(error, res);
	}
});

//
app.get("/app/books/main/:user_id?", async (req, res) => {
	try {
		let responseData = {
			bestBooks: [],
			audioBooks: [],
			audioBookCategories: [],
			categoriesWithBooks: [],
			specialBook: null,
		};

		let books = await axios({
			url: `${STRAPI_URL}/books`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			// console.log(err);
			console.log(err);
		});

		let book_categories = await axios({
			url: `${STRAPI_URL}/book-categories`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			console.log(err);
		});

		let user_saved_books = await axios({
			url: `${STRAPI_URL}/user-saved-books?users_permissions_user=${req.user.id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			console.log(err);
			console.log(err);
		});

		let special_book = await axios({
			url: `${STRAPI_URL}/special-book`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			console.log(err);
			console.log(err);
		});

		books = books?.data || [];
		book_categories = book_categories?.data || [];
		special_book = special_book?.data || null;
		user_saved_books = user_saved_books?.data || [];
		responseData.audioBookCategories = book_categories || [];
		books.forEach((book) => {
			if (book.is_featured) {
				responseData.bestBooks.push({ id: book.id, picture_path: resolveURL(book.featured_picture?.url) });
			}
			if (book.has_audio) {
				let tempAuthorsString = "";
				book.book_authors.forEach((author, index) => {
					if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
					else tempAuthorsString += `${author.author_name}  `;
				});

				const category = book_categories.find((c) => book.book_categories.find((c2) => c.id === c2.id))
				let is_saved = user_saved_books.find((save) => save.book.id == book.id);

				responseData.audioBooks.push({ id: book.id, category_id: category?.id, picture_path: resolveURL(book.picture?.formats.small?.url), authors: tempAuthorsString, name: book.name, is_saved: is_saved != undefined ? true : false });
			}
		});
		book_categories.sort((a, b) => {
			if (a.is_featured && b.is_featured) {
				return a.name.localeCompare(b.name) > 0
			}
			if (a.is_featured) {
				return 1;
			}
			if (b.is_featured) {
				return -1;
			}
			return a.name.localeCompare(b.name)
		})
		book_categories.forEach((category) => {
			let tempBooks = books
				.filter((book) => {
					let b = book.book_categories.filter((book_category) => !book.has_audio && category.id == book_category.id);
					return b.length != 0;
				})
				.map((book) => {
					console.log(book.picture?.formats)
					let tempAuthorsString = "";
					book.book_authors.forEach((author, index) => {
						if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
						else tempAuthorsString += `${author.author_name}  `;
					});
					let is_saved = user_saved_books.find((save) => save.book.id == book.id);

					return {
						id: book.id,
						picture_path: resolveURL(book.picture?.formats.small?.url),
						authors: tempAuthorsString,
						name: book.name,
						is_saved: is_saved != undefined ? true : false,
					};
				});

			// console.log(tempBooks);

			responseData.categoriesWithBooks.push({
				category_id: category.id,
				category_name: category.name,
				books: tempBooks,
			});
		});

		if (special_book?.book != null)
			responseData.specialBook = {
				id: special_book.book?.id,
				picture: resolveURL(special_book.book?.featured_picture?.url),
			};

		send200(responseData, res);
	} catch (error) {
		console.log(error);
		send400("error", res);
	}
});

app.get(`/app/podcasts/main/:user_id?`, async (req, res) => {
	try {
		let responseData = {
			savedPodcastChannels: [],
			latestPodcasts: [],
			featuredPodcastChannels: [],
			categoriesWithPodcastChannels: [],
		};

		let podcast_channels = await axios({
			url: `${STRAPI_URL}/podcast-channels`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let podcast_categories = await axios({
			url: `${STRAPI_URL}/podcast-categories`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error2";
		});

		let saved_podcasts = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?users_permissions_user.id=${req.user.id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error3";
		});

		let latest_podcasts = await axios({
			url: `${STRAPI_URL}/podcast-episodes?_sort=created_at:DESC`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error3";
		});

		podcast_channels = podcast_channels.data;
		podcast_categories = podcast_categories.data;
		saved_podcasts = saved_podcasts.data;
		latest_podcasts = latest_podcasts.data.slice(0, 12);

		saved_podcasts.map((channel) => {
			if (responseData.savedPodcastChannels.filter((searchChannel) => searchChannel.id == channel.podcast_channel.id).length == 0) {
				if (channel.podcast_channel?.id){
					responseData.savedPodcastChannels.push({
						id: channel.podcast_channel?.id,
						name: channel.podcast_channel?.name,
						picture: resolveURL(channel.podcast_channel?.cover_pic?.url),
					});
				}
			}
		});

		podcast_channels.forEach((channel) => {
			if (channel.is_featured)
				responseData.featuredPodcastChannels.push({
					id: channel.id,
					name: channel.name,
					picture: resolveURL(channel.cover_pic?.url),
				});
		});

		latest_podcasts.forEach((podcast) => {
			if (podcast.podcast_channel)
				responseData.latestPodcasts.push({
					id: podcast.id,
					name: podcast.episode_name,
					picture: resolveURL(podcast.picture?.url),
					channel_id: podcast.podcast_channel?.id,
				});
		});

		podcast_categories.forEach((category) => {
			let tempChannels = podcast_channels
				.filter((channel) => {
					let c = channel.podcast_categories.filter((podcast_category) => category.id == podcast_category.id);
					return c.length != 0;
				})
				.map((channel) => {
					let is_saved = saved_podcasts.find((save) => save.podcast_channel?.id == channel.id);
					return {
						id: channel.id,
						name: channel.name,
						picture_path: resolveURL(channel.cover_pic?.url),
						is_saved: is_saved != undefined,
					};
				});

			responseData.categoriesWithPodcastChannels.push({
				category_id: category.id,
				category_name: category.name,
				podcast_channels: tempChannels,
			});
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/my-library/:user_id?`, async (req, res) => {
	try {
		let responseData = {
			podcastChannels: [],
			books: [],
			saved: [],
		};

		let podcast_channels = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?users_permissions_user.id=${req.user.id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let boughtEbooks = await axios({
			url: `${STRAPI_URL}/customer-paid-ebooks?users_permissions_user.id=${req.user.id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let boughtAudioBooks = await axios({
			url: `${STRAPI_URL}/customer-paid-audio-books?users_permissions_user.id=${req.user.id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let savedBooks = await axios({
			url: `${STRAPI_URL}/user-saved-books?users_permissions_user.id=${req.user.id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		podcast_channels = podcast_channels.data;
		boughtEbooks = boughtEbooks.data;
		boughtAudioBooks = boughtAudioBooks.data;
		savedBooks = savedBooks.data;

		podcast_channels.forEach((channel) => {
			if (responseData.podcastChannels.filter((searchChannel) => searchChannel.id == channel.podcast_channel.id).length == 0) {
				responseData.podcastChannels.push({ id: channel.podcast_channel?.id, name: channel.podcast_channel?.name, picture: resolveURL(channel.podcast_channel.cover_pic?.formats.small?.url) });
			}
		});

		boughtEbooks.forEach((boughtBook) => {
			if (responseData.books.filter((searchBook) => searchBook.id == boughtBook.book?.id).length == 0) {
				if (boughtBook.book?.id){
					responseData.books.push({ id: boughtBook.book?.id, name: boughtBook.book?.name, picture: resolveURL(boughtBook.book?.picture?.formats.small?.url) });
				}
			}
		});

		boughtAudioBooks.forEach((boughtBook) => {
			if (responseData.books.filter((searchBook) => searchBook.id == boughtBook.book?.id).length == 0) {
				if (boughtBook.book?.id){
					responseData.books.push({ id: boughtBook.book?.id, name: boughtBook.book?.name, picture: resolveURL(boughtBook.book?.picture?.formats.small?.url) });
				}
			}
		});

		savedBooks.forEach((save) => {
			if (responseData.saved.filter((searchBook) => searchBook.id == save.book?.id).length == 0) {
				responseData.saved.push({ id: save.book?.id, name: save.book?.name, picture: resolveURL(save.book?.picture?.formats.small?.url) });
			}
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/audio-books/:book_id/:user_id?`, async (req, res) => {
	// console.log(req.headers);
	try {
		let responseData = { chapters: [] };

		let audio_books = await axios({
			url: `${STRAPI_URL}/book-audios?book.id=${req.params.book_id}&_sort=number:ASC`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error";
		});

		audio_books = audio_books.data;

		responseData.chapters = audio_books.map((book) => {
			return { id: book.id, duration: book.audio_duration, chapter_name: book.chapter_name, chapter_number: book.number, audioFile: resolveURL(book.mp3_file?.url) };
		});
		// console.log(responseData);
		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/podcast-channel/:channel_id/:user_id?`, async (req, res) => {
	try {
		let responseData = {
			channel: null,
			episodes: [],
			comments: [],
		};

		let saved_podcasts = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?podcast_channel.id=${req.params.channel_id}`,
			method: "GET",
			headers: { Authorization: `${req.headers.authorization}` },
		}).catch((err) => {
			throw "Failed to fetch user saved podcasts";
		});

		let channel = await axios({
			url: `${STRAPI_URL}/podcast-channels/${req.params.channel_id}`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "Failed to fetch podcast channel";
		});

		saved_podcasts = saved_podcasts.data;
		channel = channel.data;
		let is_saved = saved_podcasts.filter((podcast) => podcast.users_permissions_user.id == req.user.id).length != 0;

		responseData.channel = { id: channel.id, name: channel.name, description: channel.description, picture: resolveURL(channel.cover_pic?.url), followers: saved_podcasts.length, is_saved };

		responseData.episodes = channel.podcast_episodes
			.map((episode) => {
				return { id: episode.id, name: episode.episode_name, duration: episode.mp3_duration, picture: resolveURL(episode.picture?.url), audioFile: resolveURL(episode.audio_file_path?.url), number: episode.episode_number };
			})
			.sort((episode1, episode2) => episode1.number - episode2.number);

		responseData.comments = channel.podcast_channel_comments.map((comment) => {
			return { id: comment.id, userName: comment.user_name, comment: comment.comment, date: new Date(comment.created_at).toLocaleString() };
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/book/:book_id/:userId?`, async (req, res) => {
	try {
		const config = {
			Authorization: req.headers.authorization
		}
		let responseData = { book: {}, imageComments: [], comments: [], relatedBooks: [] };
		let book = await axios({ url: `${STRAPI_URL}/books/${req.params.book_id}`, method: "GET",}).catch((err) => {
			console.log(err)
			throw "error1";
		});

		let customer_paid_ebooks = await axios({ url: `${STRAPI_URL}/customer-paid-ebooks?users_permissions_user=${req.user.id}&book.id=${req.params.book_id}`, method: "GET", headers: config}).catch((err) => {
			console.log(err)
			throw "error2";
		});

		let customer_paid_books = await axios({ url: `${STRAPI_URL}/customer-paid-books?users_permissions_user=${req.user.id}&book.id=${req.params.book_id}`, method: "GET", headers: config}).catch((err) => {
			console.log(err)
			throw "error3";
		});

		let customer_paid_audio_books = await axios({ url: `${STRAPI_URL}/customer-paid-audio-books?users_permissions_user=${req.user.id}&book.id=${req.params.book_id}`, method: "GET", headers: config}).catch((err) => {
			console.log(err)
			throw "error3";
		});

		let authorRequests = book.data.book_authors.map((author) => {
			return `${STRAPI_URL}/books?book_authors_in=${author.id}`;
		});

		let related_books = [];

		await axios.all(authorRequests.map((authorRequest) => axios.get(authorRequest, {}))).then((...res) => {
			res[0].forEach((r) => r.data.forEach((re) => related_books.push(re)));
		});

		book = book.data;

		let tempAuthorsString = "";
		book.book_authors.forEach((author, index) => {
			if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
			else tempAuthorsString += `${author.author_name}  `;
		});

		const usedPromos = (await axios({
			url: `${STRAPI_URL}/users-promo-codes`,
			method: 'GET',
			params: {
				user: req.user.id,
				book: req.params.book_id,
				_limit: 1,
				_sort: 'id:desc'
			},
			headers: config
		})).data

		let promoProduct;

		if (usedPromos?.length && usedPromos[0]?.promo_code?.product) {
			promoProduct = (await axios({
				url: `${STRAPI_URL}/promo-code-products/${usedPromos[0].promo_code.product}`,
				method: 'GET',
				headers: config
			})).data
		}

		const discountPercent = promoProduct?.discount_percent || 0

		let is_paid_book = discountPercent > 99 || customer_paid_books.data?.length != 0 || (book?.book_price || 0) == 0;
		let is_paid_ebook = discountPercent > 99 || customer_paid_ebooks.data?.length != 0 || (book?.online_book_price || 0) == 0;
		let is_paid_audio_book = discountPercent > 99 || customer_paid_audio_books.data?.length != 0 || (book?.audio_book_price || 0) == 0;

		let absPdfPath = "";
		let absEpubPath = "";
		let isPdf = false;
		let isEpub = false;
		if (is_paid_ebook) {
			isPdf = book?.is_ebook_pdf
			isEpub = book?.is_ebook_epub
			absPdfPath = resolveURL(book?.pdf_book_path?.url);
			absEpubPath = resolveURL(book?.epub_book_path?.url);
		}

		responseData.book = {
			id: book.id,
			picture: resolveURL(book.picture?.formats.medium.url),
			name: book.name,
			eBookPrice: book.online_book_price,
			bookPrice: book.book_price,
			audioBookPrice: book.audio_book_price,
			discountPercent: promoProduct?.discount_percent || 0,
			hasAudio: book.has_audio,
			hasPdf: book.has_pdf,
			hasSale: book.has_sale,
			authors: tempAuthorsString,
			introduction: book.introduction,
			youtubeIntroLink: book.youtube_intro,
			is_paid_book,
			is_paid_ebook,
			is_paid_audio_book,
			pdfPath: absPdfPath,
			epubPath: absEpubPath,
			isEpub: isEpub,
			isPdf: isPdf,
			audioChapters:
				is_paid_audio_book && book.has_audio
					? book.book_audios?.map((chapter) => {
						return { id: chapter.id, name: chapter.chapter_name, duration: chapter.audio_duration, number: chapter.number };
					})
					: null,
		};

		responseData.imageComments = book.picture_comment.map((comment) => {
			return { url: resolveURL(comment?.url) };
		});

		responseData.comments = book.book_comments.map((comment) => {
			return { userName: comment.user_name, date: new Date(comment.created_at).toLocaleString(), comment: comment.comment };
		});

		related_books.forEach((book) => {
			let isDuplicated = responseData.relatedBooks.filter((related_book) => related_book.id == book.id);
			if (isDuplicated.length == 0) responseData.relatedBooks.push({ id: book.id, name: book.name, picture: resolveURL(book.picture?.formats.small.url) });
		});

		send200({ responseData }, res);
	} catch (error) {
		console.log('ERROR')
		console.log(error);
		send400(error, res);
	}
});

// ----------------------------- APP SEARCH APIs -----------------------------

app.get(`/app/search/book/audio/:search`, async (req, res) => {
	console.log("book search app");
	console.log(req.params.search);
	try {
		let responseData = {
			books: [],
		};

		let books = await axios({
			url: `${STRAPI_URL}/books`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		books = books.data;

		books.forEach((book) => {
			if (book.name.search(req.params.search) != -1 && book.has_audio) {
				let tempAuthorsString = "";
				book.book_authors.forEach((author, index) => {
					if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
					else tempAuthorsString += `${author.author_name}  `;
				});

				responseData.books.push({
					id: book.id,
					name: book.name,
					author: tempAuthorsString,
				});
			}
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/search/book/audio`, async (req, res) => {
	console.log("book search all app");
	try {
		let responseData = {
			books: [],
		};

		let books = await axios({
			url: `${STRAPI_URL}/books`,
			method: "GET",
			headers: {
				Authorization: `${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		books = books.data;

		books.forEach((book) => {
			if (book.has_audio) {
				let tempAuthorsString = "";
				book.book_authors.forEach((author, index) => {
					if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
					else tempAuthorsString += `${author.author_name}  `;
				});
				responseData.books.push({ id: book.id, name: book.name, author: tempAuthorsString });
			}
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/search/book/:search`, async (req, res) => {
	console.log("book search app");
	console.log(req.params.search);
	try {
		let responseData = { books: [] };

		let books = await axios({ url: `${STRAPI_URL}/books`, method: "GET",}).catch((err) => {
			throw "error1";
		});

		books = books.data;

		books.forEach((book) => {
			if (book.name.search(req.params.search) != -1) {
				let tempAuthorsString = "";
				book.book_authors.forEach((author, index) => {
					if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
					else tempAuthorsString += `${author.author_name}  `;
				});

				responseData.books.push({ id: book.id, name: book.name, author: tempAuthorsString });
			}
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/search/book`, async (req, res) => {
	console.log("book search all app");
	try {
		let responseData = { books: [] };

		let books = await axios({ url: `${STRAPI_URL}/books`, method: "GET",}).catch((err) => {
			throw "error1";
		});

		books = books.data;

		responseData.books = books.map((book) => {
			let tempAuthorsString = "";
			book.book_authors.forEach((author, index) => {
				if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
				else tempAuthorsString += `${author.author_name}  `;
			});
			return {
				id: book.id,
				name: book.name,
				author: tempAuthorsString,
			};
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/search/podcast`, async (req, res) => {
	console.log("book podcast all app");
	try {
		let responseData = { podcast_channels: [] };

		let podcast_channels = await axios({ url: `${STRAPI_URL}/podcast-channels`, method: "GET",}).catch((err) => {
			throw "error1";
		});

		podcast_channels = podcast_channels.data;

		responseData.podcast_channels = podcast_channels.map((channel) => {
			return {
				id: channel.id,
				name: channel.name,
			};
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/search/podcast/:search`, async (req, res) => {
	console.log("book podcast search app");
	try {
		let responseData = { podcast_channels: [] };

		let podcast_channels = await axios({ url: `${STRAPI_URL}/podcast-channels`, method: "GET",}).catch((err) => {
			throw "error1";
		});

		podcast_channels = podcast_channels.data;

		podcast_channels.forEach((channel) => {
			if (channel.name.search(req.params.search) != -1)
				responseData.podcast_channels.push({
					id: channel.id,
					name: channel.name,
				});
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

// POST
app.post('/app/promo', async (req, res) => {

	const userId = req.user?.id;
	const nowParam = moment().format('YYYY-MM-DD+HH:mm:ss')
	const promoCode = req.body.promoCode;
	const bookId = req.body.bookId;
	const foundPromoCodes = (await axios({
		url: `${STRAPI_URL}/promo-codes?code=${promoCode}&end_date_gt=${nowParam}&_sort=id:desc&_limit=1`,
		method: 'GET'
	})).data
	const foundPromoCode = foundPromoCodes?.length ? foundPromoCodes[0] : null;
	if (!foundPromoCode || (parseInt(foundPromoCode?.book?.id) !== parseInt(bookId))) {
		return res.status(400).send({message: 'Промо код олдсонгүй'})
	}

	// validate promo end date
	const promoProduct = (await axios({
		url: `${STRAPI_URL}/promo-code-products/${foundPromoCode.product.id}`
	})).data

	if (!promoProduct) {
		return res.status(400).send({
			message: 'Промо код идэвхигүй байна'
		})
	}

	if (promoProduct.is_gift) {
		const usedGifts = (await axios({ 
			url: `${STRAPI_URL}/users-promo-codes?promo_code.code=${promoCode}&promo_code.end_date_gt=${nowParam}`,method: "GET"})).data;
		if (usedGifts?.length) {
			return res.status(400).send({message: 'Промо код хэрэглэгдсэн байна'})
		}
	} else if (promoProduct.is_discount) {
		const usedDiscount = (await axios({ 
			url: `${STRAPI_URL}/users-promo-codes?promo_code.code=${promoCode}&promo_code.end_date_gt=${nowParam}&user=${userId}&_limit=1`,
			method: "GET"})).data;
		if (usedDiscount?.length) {
			return res.status(400).send({message: 'Промо код хэрэглэгдсэн байна'})
		}
	} else {
		return res.status(400).send({ message: 'Промо код идэвхигүй байна' })
	}

	if (moment().isAfter(moment(foundPromoCode.end_date))) {
		return res.status(400).send({message: 'Промо кодын хугацаа дууссан байна'})
	}
	try {
		const writeResponse = await axios({
			url: `${STRAPI_URL}/users-promo-codes`, 
			method: 'POST', 
			data: {
				promo_code: foundPromoCode.id,
				'book': bookId,
				'user': req.user.id
			}})
		
		res.send({
			message: 'success'
		})
	} catch(e) {
		console.log(e)
		res.status(400).send({mesasge: `Промо код олдсонгүй`})
	}
})

// Legacy endpoints
app.use(legacyPrivateRoutes);

// ----------------------------- UTILITY FUNCTIONs -----------------------------

function getAge(dateString) {
	var today = new Date();
	var birthDate = new Date(dateString);
	var age = today.getFullYear() - birthDate.getFullYear();
	var m = today.getMonth() - birthDate.getMonth();
	if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
		age--;
	}
	return age;
}

// SEND 400 with message
function send400(message, res) {
	res.status(400).send({ message });
}

// SEND 200 with data
function send200(data, res) {
	res.status(200).send(data);
}

function create_temp_unique_text(format) {
	return format.replace(/[xy]/g, function (c) {
		var r = (Math.random() * 16) | 0,
			v = c == "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16).toUpperCase();
	});
}

app.listen(port, () => {
	console.log(`Listening at port ${port}`);
});
