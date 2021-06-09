import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";
import { fileURLToPath } from "url";
import path, { dirname } from "path";
import http from "http";
import fs from "fs";
import * as client from "twilio";
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const STRAPI_URL = "https://strapi.monnom.mn";
const STRAPI_URL_IP = "https://strapi.monnom.mn";

// For OTP
const SKYTEL_TOKEN = "443d503255559117690576e36f84ffe896f3f693";

// For payment
const QPAY_MERCHANT_USERNAME = "HAN_AQUA";
const QPAY_MERCHANT_PASSWORD = "UOaod0R9";
const QPAY_MERCHANT_INVOICE_NAME = "HANAQUA_INVOICE";
const QPAY_MERCHANT = "https://merchant.qpay.mn/v2/invoice";
const QPAY_MERCHANT_AUTHENTICATION = "https://merchant.qpay.mn/v2/auth/token";

// Book payment types
const PAYMENT_EBOOK_MAGIC_WORD = "ebook";
const PAYMENT_AUDIO_BOOK_MAGIC_WORD = "audio-book";
const PAYMENT_BOOK_MAGIC_WORD = "book";

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const fileStorageEngine = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, "./uploads");
	},
	filename: (req, file, cb) => {
		cb(null, `${file.originalname}`);
	},
});

const upload = multer({ storage: fileStorageEngine });

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

		// Get QPAY access token
		let qpay_access = await axios({
			method: "POST",
			url: QPAY_MERCHANT_AUTHENTICATION,
			auth: {
				username: QPAY_MERCHANT_USERNAME,
				password: QPAY_MERCHANT_PASSWORD,
			},
		}).catch((err) => {
			throw "QPAY authorization failed";
		});
		// For get book price
		let book = await axios({
			method: "GET",
			url: `${STRAPI_URL}/books/${req.body.book_id}`,
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "Fetch book failed";
		});

		qpay_access = qpay_access.data;
		book = book.data;

		let data = {
			invoice_code: QPAY_MERCHANT_INVOICE_NAME,
			sender_invoice_no: tempInvoiceId,
			invoice_receiver_code: req.body.user_id.toString(),
			invoice_description: `Monnom Audio Book - ${req.body.book_name} төлбөр.`,
			amount: null,
			callback_url: `https://express.monnom.mn/payment/payment-callback/${tempInvoiceId}/${model_name}/${req.headers.authorization}`,
			// callback_url: `https://express.monnom.mn/payment-callback/${tempInvoiceId}/${model_name}/${req.body.book_id}`,
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

		console.log(data);
		let qpay_invoice_creation = await axios({
			method: "POST",
			url: QPAY_MERCHANT,
			headers: {
				Authorization: `Bearer ${qpay_access.access_token}`,
			},
			data,
		}).catch((err) => {
			console.log(err);
			throw "Invoice creation failed";
		});

		await axios({
			method: "POST",
			url: `${STRAPI_URL}/payments`,
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
			data: {
				users_permissions_user: req.body.user_id,
				payment_amount: book.online_book_price,
				is_approved: false,
				book_payment_type: req.params.payment_type,
				book: req.body.book_id,
				invoice_id: tempInvoiceId,
			},
		}).catch(() => {
			throw "Save payment failed";
		});

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

app.get("/payment/payment-callback/:invoice_id/:payment_collection_name/:auth_token", async (req, res, next) => {

	try {

		const apiClient = axios.create({
			baseURL: STRAPI_URL,
			headers: {
				Authorization: `Bearer ${req.params.auth_token}`
			}
		})
		const invoice_id = req.params.invoice_id;
		let paymentResponse = await apiClient.get(`${STRAPI_URL}/payments?invoice_id=${invoice_id}`).catch((err) => {
			throw "Fetching payment failed";
		});

		paymentResponse = paymentResponse.data[0];

		let paymentUpdateResponse;
		try {
			paymentUpdateResponse = await apiClient.put(`${STRAPI_URL}/payments/${paymentResponse.id}`, {
				is_approved: true, payment_data: JSON.stringify(req.body || {}) + "get"
			})
		} catch (e) {
			throw 'Payment update failed';
		}

		paymentUpdateResponse = paymentUpdateResponse.data;

		await apiClient
			.post(`${STRAPI_URL}/${req.params.payment_collection_name}`, {
				book: paymentUpdateResponse.book.id,
				users_permissions_user: paymentUpdateResponse.users_permissions_user.id,
				payment: paymentUpdateResponse.id,
			})
			.catch((err) => {
				throw "Failed to save on collection name";
			});

		const userResponse = await apiClient.get(`/users?id=${paymentUpdateResponse.users_permissions_user.id}`);
		const user = userResponse.data[0];
		const fcmToken = user?.fcm_token;
		await axios({
			url: "https://fcm.googleapis.com/fcm/send",
			method: "POST",
			headers: {
				Authorization: `key=${process.env.FCM_SERVER_KEY}`,
			},
			data: {
				registration_ids: [fcmToken],
				channel_id: "fcm_default_channel",
				notification: {
					title: 'Төлбөр амжилттай',
					body: '',
				},
				data: {
					title: 'Төлбөр амжилттай',
					body: '',
					book_id: paymentUpdateResponse.book.id,
					type: 'book_payment'
				},
			},
		}).catch((err) => {
			console.log(err);
			throw "Failed to send notification";
		});
		send200(paymentUpdateResponse, res);
	} catch (e) {
		console.log(e);
		send400(e, res);
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
		let responseData = {
			totalPodcastChannels: 0,
			totalPodcastFollows: 0,
			totalRadioChannels: 0,
			totalAudioBooks: 0,
			totalEBooks: 0,
			totalBooks: 0,
			usersByGender: {
				maleCount: 0,
				femaleCount: 0,
				othersCount: 0,
			},
			usersByAge: {
				category18: 0,
				category18_28: 0,
				category28_38: 0,
				category38_48: 0,
				category48_58: 0,
				category58: 0,
			},
			mostFollowedPodcastChannels: [],
			mostBoughtBooks: [],
			mostBoughtAudioBooks: [],
			mostBoughtPDFBooks: [],
		};

		let customer_saved_books = await axios({
			url: `${STRAPI_URL}/customer-paid-books`,
			method: "GET",
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
			throw "error saved books";
		});

		let customer_saved_ebooks = await axios({
			url: `${STRAPI_URL}/customer-paid-ebooks`,
			method: "GET",
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
			throw "error saved ebooks";
		});

		let podcast_channels = await axios({
			url: `${STRAPI_URL}/podcast-channels`,
			method: "GET",
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
			throw "error podcast channels";
		});

		let podcast_channels_saves = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts`,
			method: "GET",
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
			throw "error saved podcasts";
		});

		let totalRadioChannels = await axios({
			url: `${STRAPI_URL}/radio-channels/count`,
			method: "GET",
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
			throw "error radio";
		});

		let books = await axios({
			url: `${STRAPI_URL}/books`,
			method: "GET",
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
			throw "error books";
		});

		let app_users = await axios({
			url: `${STRAPI_URL}/users?user_role=6`,
			method: "GET",
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
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
			else
				tempBooks.push({
					id: buy.book?.id,
					name: buy.book?.name,
					is_featured: buy.book?.is_featured ? "Тийм" : "Үгүй",
					bought_count: 1,
				});
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
				else
					tempAudioBooks.push({
						id: buy.book?.id,
						name: buy.book?.name,
						is_featured: buy.book?.is_featured ? "Тийм" : "Үгүй",
						bought_count: 1,
					});
			}
			// PDF COUNTS
			if (buy.book?.has_pdf) {
				if (tempPDFBook_loop != undefined && tempPDFBooks.length != 0) tempPDFBook_loop.bought_count += 1;
				else
					tempPDFBooks.push({
						id: buy.book?.id,
						name: buy.book?.name,
						is_featured: buy.book?.is_featured ? "Тийм" : "Үгүй",
						bought_count: 1,
					});
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
		let sendData = {
			available_authors: null,
			available_categories: null,
		};
		let authors = await axios({
			method: "GET",
			url: `${STRAPI_URL}/book-authors`,
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
			throw "error-authors";
		});
		let categories = await axios({
			method: "GET",
			url: `${STRAPI_URL}/book-categories`,
			headers: {
				Authorization: req.headers.authorization,
			},
		}).catch((err) => {
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
	console.log("book single");
	console.log(req.headers);
	const headers = {
		Authorization: req.headers.authorization,
	};
	await axios({
		url: `${STRAPI_URL}/users/${req.params.id}`,
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
		.then(async (response) => {
			// TODO user data
			let sendData = {
				user: {
					id: response.data.id,
					user_fullname: response.data.fullname,
					user_pic_url: response.data.profile_picture ? response.data.profile_picture.url : null,
					user_mail: response.data.email,
					user_joined_date: response.data.created_at,
					user_phone: response.data.phone,
				},
				user_books: null,
				available_authors: null,
				available_categories: null,
			};
			await axios({
				method: "GET",
				url: `${STRAPI_URL}/books?users_permissions_user.id=${req.params.id}`,
				// headers: headers,
			})
				.then(async (response) => {
					// console.log(response.data);
					sendData.user_books = response.data.map((book) => {
						return {
							id: book.id,
							book_pic_url: (book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${book.picture?.url}` : book.picture?.url,
							book_name: book.name,
							book_author: book.book_authors.map((author) => {
								return {
									id: author.id,
									name: author.author_name,
								};
							}),
							book_category: book.book_categories.map((category) => {
								return {
									id: category.id,
									name: category.name,
								};
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
					await axios({
						method: "GET",
						url: `${STRAPI_URL}/book-authors`,
						// headers: headers,
					})
						.then(async (responseAuthors) => {
							sendData.available_authors = responseAuthors.data;
							await axios({
								method: "GET",
								url: `${STRAPI_URL}/book-categories`,
								// headers: headers,
							})
								.then(async (responseCategories) => {
									sendData.available_categories = responseCategories.data;
									await axios({
										method: "GET",
										url: `${STRAPI_URL}/customer-paid-books`,
										// headers: headers,
									})
										.then((responsePayments) => {
											sendData.user_books.forEach((book) => (book.book_sales_count = responsePayments.data.filter((payment) => book.id == payment.book?.id).length));
										})
										.catch((err) => {
											// send400("error", res);
											throw "broken1";
										});
									await axios({
										method: "GET",
										url: `${STRAPI_URL}/customer-paid-ebooks`,
										// headers: headers,
									})
										.then((responsePayments) => {
											sendData.user_books.forEach((book) => (book.online_book_sales_count = responsePayments.data.filter((payment) => book.id == payment.book?.id).length));
										})
										.catch((err) => {
											// send400("error", res);
											throw "broken2";
										});
								})
								.catch((err) => {
									throw "broken3";
									// send400("error", res);
								});
						})
						.catch((err) => {
							throw "broken4";
							// send400("error", res);
						});

					// TODO book data
					res.send(sendData);
				})
				.catch((err) => {
					throw "broken5";
				});
		})
		.catch((err) => {
			send400(err, res);
		});

	// res.send(test);
});

// Information about specific podcast channel
app.get("/podcast-channels/:id", async (req, res) => {
	await axios({
		url: `${STRAPI_URL}/podcast-channels/${req.params.id}`,
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
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
				channel_cover_pic: response.data.cover_pic != null ? response.data.cover_pic.url : null,
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
			// let sendData = response.data.filter(
			// 	(data) =>
			// 		data.user_role == 1 || data.user_role == 2 || data.user_role == 3
			// );
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
			Authorization: req.headers.authorization,
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
		.post(`${STRAPI_URL}/podcast-episodes`, formData, { Authorization: req.headers.authorization })
		.then(async (res) => {
			let tempResponse = res.data;
			let imageData = new FormData();

			imageData.append(`files`, profile_picture_create);

			imageData.append("refId", res.data.id);
			imageData.append("ref", "user");
			imageData.append("field", "profile_picture");
			imageData.append("source", "users-permissions");

			await axios
				.post("${STRAPI_URL}/upload", imageData, { Authorization: req.headers.authorization })
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
		headers: { "content-type": "multipart/form-data", Authorization: req.headers.authorization },
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
			Authorization: req.headers.authorization,
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
app.post("/admin-login", async (req, res) => {
	console.log(req.body);
	await axios
		.post(`${STRAPI_URL}/auth/local`, { identifier: req.body.identifier, password: req.body.password }, { Authorization: req.headers.authorization })
		.then((response) => {
			send200(response.data, res);
		})
		.catch((err) => {
			send400("error", res);
		});
});

app.get("/settings-page", async (req, res) => {
	try {
		let settings = await axios({
			url: `${STRAPI_URL}/settings`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error";
		});

		let podcast_categories = await axios({
			url: `${STRAPI_URL}/podcast-categories`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let book_categories = await axios({
			url: `${STRAPI_URL}/book-categories`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error2";
		});

		let book_authors = await axios({
			url: `${STRAPI_URL}/book-authors`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
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
app.get("/all-admins-list", async (req, res) => {
	// console.log(req);
	await axios({
		url: `${STRAPI_URL}/users`,
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
		.then((response) => {
			let sendData = response.data.filter((data) => data.user_role == 1 || data.user_role == 2 || data.user_role == 3 || data.user_role == 4 || data.user_role == 5);
			send200(sendData, res);
		})
		.catch((err) => {
			console.log(err);
			send400("error", res);
		});
});

// List of employees who are don't have podcast channel
app.get("/all-admins-settings", async (req, res) => {
	// console.log(req);
	await axios({
		url: `${STRAPI_URL}/users?podcast_channel_null=true`,
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
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
			Authorization: req.headers.authorization,
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
			Authorization: req.headers.authorization,
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
							podcast_pic_url: data.cover_pic?.url,
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
		url: `${STRAPI_URL}/users`,
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
		.then((response) => {
			let sendData = response.data.filter((data) => data.user_role == 6);
			send200(sendData, res);
			// res.send(sendData);
		})
		.catch((err) => {
			// console.log(err);
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
				Authorization: req.headers.authorization,
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
						book_pic_url: (book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${book.picture?.url}` : book.picture?.url,
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

// Unsave podcast channel
app.post("/app/unsave-podcast-channel", async (req, res, next) => {
	try {
		console.log("unsave podcast channel");
		let saves = [];
		let saved_podcasts = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?podcast_channel.id=${req.body.channel_id}&users_permissions_user=${req.body.user_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
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
				Authorization: req.headers.authorization,
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
						Authorization: req.headers.authorization,
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
			Authorization: `Bearer ${req.headers.authorization}`,
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
				Authorization: `Bearer ${req.headers.authorization}`,
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

		// ------------ FIND CURRENT MP3 FILE PATH ------------
		channel_audio.forEach((audio) => {
			if (differce < parseInt(audio.audio_duration)) {
				responseData.current_second = parseInt(audio.audio_duration) - (parseInt(audio.audio_duration) - differce);
				responseData.episode_id = audio.id;
			} else {
				differce -= parseInt(audio.audio_duration);
			}
		});

		responseData.episodes = channel_audio.map((episode) => {
			return {
				id: episode.id,
				mp3_file_path: `${episode.audio?.url}`,
				duration: episode.audio_duration,
			};
		});

		send200(responseData, res);
	} catch (error) {
		send400(error, res);
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
					throw "error";
				});
		})
		.catch((err) => {
			console.log(err);
			console.log("1st");
			send400("error", res);
		});
});

//
app.get("/app/books/main/:user_id", async (req, res) => {
	try {
		let responseData = {
			bestBooks: [],
			audioBooks: [],
			categoriesWithBooks: [],
			specialBook: null,
		};

		let books = await axios({
			url: `${STRAPI_URL}/books`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			// console.log(err);
			console.log(err);
		});

		let book_categories = await axios({
			url: `${STRAPI_URL}/book-categories`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			console.log(err);
		});

		let user_saved_books = await axios({
			url: `${STRAPI_URL}/user-saved-books?users_permissions_user=${req.params.user_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			console.log(err);
			console.log(err);
		});

		let special_book = await axios({
			url: `${STRAPI_URL}/special-book`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			console.log(err);
			console.log(err);
		});

		books = books?.data || [];
		book_categories = book_categories?.data || [];
		special_book = special_book?.data || [];
		user_saved_books = user_saved_books?.data || [];

		books.forEach((book) => {
			if (book.is_featured) {
				responseData.bestBooks.push({
					id: book.id,
					picture_path: (book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${book.picture?.url}` : book.picture?.url,
				});
			}
			if (book.has_audio) {
				let tempAuthorsString = "";
				book.book_authors.forEach((author, index) => {
					if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
					else tempAuthorsString += `${author.author_name}  `;
				});

				let is_saved = user_saved_books.find((save) => save.book.id == book.id);

				responseData.audioBooks.push({
					id: book.id,
					picture_path: (book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${book.picture?.url}` : book.picture?.url,
					authors: tempAuthorsString,
					name: book.name,
					is_saved: is_saved != undefined ? true : false,
				});
			}
		});
		book_categories.forEach((category) => {
			let tempBooks = books
				.filter((book) => {
					let b = book.book_categories.filter((book_category) => category.id == book_category.id);
					return b.length != 0;
				})
				.map((book) => {
					let tempAuthorsString = "";
					book.book_authors.forEach((author, index) => {
						if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
						else tempAuthorsString += `${author.author_name}  `;
					});
					let is_saved = user_saved_books.find((save) => save.book.id == book.id);

					return {
						id: book.id,
						picture_path: (book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${book.picture?.url}` : book.picture?.url,
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

		if (special_book.book != null)
			responseData.specialBook = {
				id: special_book.book?.id,
				picture: `${(special_book.book?.picture?.url || '').startsWith('/') ? `${STRAPI_URL}${special_book.book?.picture?.url}` : special_book.book?.picture?.url}`,
			};

		send200(responseData, res);
	} catch (error) {
		console.log(error);
		send400("error", res);
	}
});

app.get(`/app/podcasts/main/:user_id`, async (req, res) => {
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
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let podcast_categories = await axios({
			url: `${STRAPI_URL}/podcast-categories`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error2";
		});

		let saved_podcasts = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?users_permissions_user.id=${req.params.user_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error3";
		});

		let latest_podcasts = await axios({
			url: `${STRAPI_URL}/podcast-episodes?_sort=created_at:DESC`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error3";
		});

		podcast_channels = podcast_channels.data;
		podcast_categories = podcast_categories.data;
		saved_podcasts = saved_podcasts.data;
		latest_podcasts = latest_podcasts.data.slice(0, 12);

		responseData.savedPodcastChannels = saved_podcasts.map((channel) => {
			return {
				id: channel.podcast_channel?.id,
				name: channel.podcast_channel?.name,
				picture: `${STRAPI_URL_IP}${channel.podcast_channel?.cover_pic?.url}`,
			};
		});

		podcast_channels.forEach((channel) => {
			if (channel.is_featured)
				responseData.featuredPodcastChannels.push({
					id: channel.id,
					name: channel.name,
					picture: `${STRAPI_URL_IP}${channel.cover_pic?.url}`,
				});
		});

		latest_podcasts.forEach((podcast) => {
			responseData.latestPodcasts.push({
				id: podcast.id,
				name: podcast.episode_name,
				picture: `${STRAPI_URL_IP}${podcast.picture?.url}`,
				channel_id: podcast.podcast_channel.id,
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
						picture_path: `${STRAPI_URL_IP}${channel.cover_pic?.url}`,
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

app.get(`/app/my-library/:user_id`, async (req, res) => {
	try {
		let responseData = {
			podcastChannels: [],
			books: [],
			saved: [],
		};

		let podcast_channels = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?users_permissions_user.id=${req.params.user_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let boughtBooks = await axios({
			url: `${STRAPI_URL}/customer-paid-ebooks?users_permissions_user.id=${req.params.user_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let savedBooks = await axios({
			url: `${STRAPI_URL}/user-saved-books?users_permissions_user.id=${req.params.user_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		podcast_channels = podcast_channels.data;
		boughtBooks = boughtBooks.data;
		savedBooks = savedBooks.data;

		responseData.podcastChannels = podcast_channels.map((channel) => {
			return {
				id: channel.podcast_channel.id,
				name: channel.podcast_channel.name,
				picture: `${STRAPI_URL_IP}${channel.podcast_channel.cover_pic?.url}`,
			};
		});

		responseData.books = boughtBooks.map((boughtBook) => {
			return {
				id: boughtBook.book.id,
				name: boughtBook.book.name,
				picture: (boughtBook.book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${boughtBook.book.picture?.url}` : boughtBook.book.picture?.url,
			};
		});

		responseData.saved = savedBooks.map((save) => {
			return {
				id: save.book.id,
				name: save.book.name,
				picture: (save.book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${save.book.picture?.url}` : save.book.picture?.url,
			};
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/audio-books/:book_id/:user_id`, async (req, res) => {
	// console.log(req.headers);
	try {
		let responseData = {
			chapters: [],
		};

		let audio_books = await axios({
			url: `${STRAPI_URL}/book-audios?book.id=${req.params.book_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error";
		});

		audio_books = audio_books.data;

		responseData.chapters = audio_books.map((book) => {
			return {
				id: book.id,
				duration: book.audio_duration,
				chapter_name: book.chapter_name,
				chapter_number: book.number,
				audioFile: (book.mp3_file?.url || '').startsWith('/') ? `${STRAPI_URL}${book.mp3_file?.url}` : book.mp3_file?.url,
			};
		});
		// console.log(responseData);
		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/podcast-channel/:channel_id/:user_id`, async (req, res) => {
	try {
		let responseData = {
			channel: null,
			episodes: [],
			comments: [],
		};

		console.log(req.headers);

		let saved_podcasts = await axios({
			url: `${STRAPI_URL}/user-saved-podcasts?podcast_channel.id=${req.params.channel_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "Failed to fetch user saved podcasts";
		});

		let channel = await axios({
			url: `${STRAPI_URL}/podcast-channels/${req.params.channel_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "Failed to fetch podcast channel";
		});

		saved_podcasts = saved_podcasts.data;
		channel = channel.data;
		let is_saved = saved_podcasts.filter((podcast) => podcast.users_permissions_user.id == req.params.user_id).length != 0;

		responseData.channel = {
			id: channel.id,
			name: channel.name,
			description: channel.description,
			picture: `${STRAPI_URL_IP}${channel.cover_pic?.url}`,
			followers: saved_podcasts.length,
			is_saved,
		};

		responseData.episodes = channel.podcast_episodes
			.map((episode) => {
				return {
					id: episode.id,
					name: episode.episode_name,
					duration: episode.mp3_duration,
					picture: `${STRAPI_URL_IP}${episode.picture?.url}`,
					audioFile: `${STRAPI_URL_IP}${episode.audio_file_path?.url}`,
					number: episode.episode_number,
				};
			})
			.sort((episode1, episode2) => episode1.number - episode2.number);

		responseData.comments = channel.podcast_channel_comments.map((comment) => {
			return {
				id: comment.id,
				userName: comment.user_name,
				comment: comment.comment,
				date: new Date(comment.created_at).toLocaleString(),
			};
		});

		send200({ responseData }, res);
	} catch (error) {
		send400(error, res);
	}
});

app.get(`/app/book/:book_id/:user_id`, async (req, res) => {
	try {
		let responseData = {
			book: {},
			imageComments: [],
			comments: [],
			relatedBooks: [],
		};
		let book = await axios({
			url: `${STRAPI_URL}/books/${req.params.book_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error1";
		});

		let sales_count = await axios({
			url: `${STRAPI_URL}/customer-paid-ebooks?book.id=${req.params.book_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error2";
		});

		let customer_paid_ebooks = await axios({
			url: `${STRAPI_URL}/customer-paid-ebooks?users_permissions_user=${req.params.user_id}&book.id=${req.params.book_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error2";
		});

		let customer_paid_books = await axios({
			url: `${STRAPI_URL}/customer-paid-books?users_permissions_user=${req.params.user_id}&book.id=${req.params.book_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error3";
		});

		let customer_paid_audio_books = await axios({
			url: `${STRAPI_URL}/customer-paid-audio-books?users_permissions_user=${req.params.user_id}&book.id=${req.params.book_id}`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
			throw "error3";
		});

		let authorRequests = book.data.book_authors.map((author) => {
			return `${STRAPI_URL}/books?book_authors_in=${author.id}`;
		});

		let related_books = [];

		await axios.all(authorRequests.map((authorRequest) => axios.get(authorRequest, {
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`
			}
		}))).then((...res) => {
			res[0].forEach((r) => r.data.forEach((re) => related_books.push(re)));
		});

		book = book.data;
		sales_count = sales_count.data.length;

		let tempAuthorsString = "";
		book.book_authors.forEach((author, index) => {
			if (index == book.book_authors.length - 1) tempAuthorsString += `${author.author_name}`;
			else tempAuthorsString += `${author.author_name}  `;
		});

		let is_paid_book = customer_paid_books.data?.length != 0 || (book?.book_price || 0) == 0;
		let is_paid_ebook = customer_paid_ebooks.data?.length != 0 || (book?.online_book_price || 0) == 0;
		let is_paid_audio_book = customer_paid_audio_books.data?.length != 0 || (book?.audio_book_price || 0) == 0;

		let absPdfPath = '';
		if (is_paid_ebook) {
			absPdfPath = (book?.pdf_book_path?.url || '').startsWith('/') ? (`${STRAPI_URL_IP}${book.pdf_book_path?.url}`) : (book.pdf_book_path?.url)
		}
		responseData.book = {
			id: book.id,
			picture: (book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${book.picture?.url}` : book.picture?.url,
			name: book.name,
			eBookPrice: book.online_book_price,
			bookPrice: book.book_price,
			audioBookPrice: book.audio_book_price,
			salesCount: sales_count,
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
			audioChapters:
				is_paid_audio_book && book.has_audio
					? book.book_audios?.map((chapter) => {
						return {
							id: chapter.id,
							name: chapter.chapter_name,
							duration: chapter.audio_duration,
							number: chapter.number,
						};
					})
					: null,
		};

		responseData.imageComments = book.picture_comment.map((comment) => {
			return {
				url: (comment?.url || '').startsWith('/') ? `${STRAPI_URL}${comment.url}` : comment.url,
			};
		});

		responseData.comments = book.book_comments.map((comment) => {
			return {
				userName: comment.user_name,
				date: new Date(comment.created_at).toLocaleString(),
				comment: comment.comment,
			};
		});

		related_books.forEach((book) => {
			let isDuplicated = responseData.relatedBooks.filter((related_book) => related_book.id == book.id);
			if (isDuplicated.length == 0)
				responseData.relatedBooks.push({
					id: book.id,
					name: book.name,
					picture: (book.picture?.url || '').startsWith('/') ? `${STRAPI_URL_IP}${book.picture?.url}` : book.picture?.url,
				});
		});

		send200({ responseData }, res);
	} catch (error) {
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
				Authorization: `Bearer ${req.headers.authorization}`,
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
				Authorization: `Bearer ${req.headers.authorization}`,
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

app.get(`/app/search/book/:search`, async (req, res) => {
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
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
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

app.get(`/app/search/book`, async (req, res) => {
	console.log("book search all app");
	try {
		let responseData = {
			books: [],
		};

		let books = await axios({
			url: `${STRAPI_URL}/books`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
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
		let responseData = {
			podcast_channels: [],
		};

		let podcast_channels = await axios({
			url: `${STRAPI_URL}/podcast-channels`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
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
		let responseData = {
			podcast_channels: [],
		};

		let podcast_channels = await axios({
			url: `${STRAPI_URL}/podcast-channels`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${req.headers.authorization}`,
			},
		}).catch((err) => {
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
