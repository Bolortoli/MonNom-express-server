// import axios from "axios";
// import createError from "http-errors";
// // var createError = require("http-errors");
// import express from "express";
// import {} from "module";
// // var express = require("express");
// // var path = require("path");
// // var cookieParser = require("cookie-parser");
// // var logger = require("morgan");

// // var indexRouter = require("./routes/index");
// // var usersRouter = require("./routes/users");

import indexRouter from "./routes/index.js";
import express from "express";
const app = express();
const port = 3001;
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";

// var app = express();

// // view engine setup
// app.set("views", path.join(__dirname, "views"));
// app.set("view engine", "pug");

// app.use(logger("dev"));
// app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
app.use(cors());
// app.use(bodyParser.json());
// app.use(
// 	bodyParser.urlencoded({
// 		extended: true,
// 		parameterLimit: 50000,
// 	})
// );
app.use(bodyParser.json());
// app.use(
// 	bodyParser.urlencoded({
// 		extended: true,
// 	})
// );
// app.use(bodyParser.raw({ type: "*/*" }));
const fileStorageEngine = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, "./uploads");
	},
	filename: (req, file, cb) => {
		cb(null, `${Date.now()}-${file.originalname}`);
	},
});

const upload = multer({ storage: fileStorageEngine });

app.get("/podcast-channels/:id", async (req, res, next) => {
	await axios({
		url: `http://127.0.0.1:1337/podcast-channels/${req.params.id}`,
		method: "GET",
		// headers: {
		// 	Authorization: req.headers.authorization,
		// },
	})
		.then((response) => {
			// console.log("got fcken success");
			// console.log(response.data);
			let sendData = {
				id: response.data.id,
				user_firstname: response.data.content_maker_id.firstname,
				user_lastname: response.data.content_maker_id.lastname,
				channel_name: response.data.name,
				channel_created_at: response.data.created_at,
				channel_updated_at: response.data.updated_at,
				channel_description: response.data.description,
				channel_cover_pic:
					response.data.cover_pic != null
						? response.data.cover_pic.formats.small.url
						: null,
				user_podcasts: response.data.podcast_eposides.map((d) => {
					return {
						id: d.id,
						podcast_name: d.name,
						podcast_file_name: d.audio_file_path[0].name,
						podcast_file_size: d.audio_file_path[0].size,
						podcast_desc: d.description,
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
			res.send({ response: "error" });
		});
	// res.send(req.params.id);
});

app.post(
	"/create-admin",
	upload.single("profile_picture"),
	async (req, res, next) => {
		console.log(req.body);
		try {
			// console.log("------------AUTHORIZATION HEADER ------------");
			// console.log(req.headers.authorization);
			await axios({
				url: "http://127.0.0.1:1337/users",
				method: "POST",
				headers: {
					Authorization: req.headers.authorization,
				},
				body: {
					username: req.body.username,
					password: req.body.password,
					role: 1,
					phone: req.body.phone,
					gender: req.body.gender,
					fullname: req.body.fullname,
					user_role: req.body.user_role,
					email: "bo@csg.dme",
				},
			})
				.then((response) => {
					// console.log(response.data);
					res.send(response.data);
				})
				.catch((err) => {
					// console.log("%cerror", "font-size: 15px;");
					console.log(err.response.data);
					res.send(err.response.data);
					// throw new Error("BROKEN");
				});
		} catch (err) {
			next(err);
		}
	}
);

app.post("/admin-login", async (req, res) => {
	console.log(req.body);
	await axios
		.post("http://127.0.0.1:1337/auth/local", {
			identifier: req.body.identifier,
			password: req.body.password,
		})
		.then((response) => {
			console.log("got fcken success");
			console.log(response.data);
			res.send(response.data);
		})
		.catch((err) => {
			// console.log(err);
			res.send({ response: "error" });
		});
	console.log(req.body);
});

app.get("/all-admins-list", async (req, res) => {
	// console.log(req);
	await axios({
		url: "http://127.0.0.1:1337/users",
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
		.then((response) => {
			// console.log("got fcken success");
			// console.log(response.data);
			// let sendData = response.data;
			let sendData = response.data.filter(
				(data) =>
					data.user_role == 1 || data.user_role == 2 || data.user_role == 3
			);
			res.send(sendData);
		})
		.catch((err) => {
			console.log(err);
			res.send({ response: "error" });
		});
});

app.post("/update-employee", async (req, res) => {
	// console.log(req);
	let id = req.body.id;
	let body = Object.assign(req.body);
	delete body["id"];
	await axios({
		headers: {
			Authorization: req.headers.authorization,
		},
		url: `http://127.0.0.1:1337/users/${id}`,
		method: "PUT",
		data: body,
	})
		.then((response) => {
			// console.log("got fcken success");
			// console.log(response.data);
			res.send(response.data);
		})
		.catch((err) => {
			console.log(err);
			res.send({ response: "error" });
		});
});

app.get("/podcast-channels", async (req, res) => {
	await axios({
		// headers: {
		// 	Authorization: req.headers.authorization,
		// },
		url: `http://127.0.0.1:1337/podcast-channels`,
		method: "GET",
	})
		.then((response) => {
			let sendableData = {
				podcastChannels: response.data
					.map((data) => {
						console.log(data);
						return {
							id: data.id,
							podcast_author: {
								id: data.content_maker_id.id,
								firstname: data.content_maker_id.firstname,
								lastname: data.content_maker_id.lastname,
							},
							podcast_name: data.name,
							podcast_pic_url: data.cover_pic.formats.small.url,
							episode_count: data.podcast_eposides.length,
							podcast_added_date: data.created_at,
						};
						// else return null;
					})
					.filter((data) => data),
			};
			res.send(sendableData);
			// res.send(response.data);
		})
		.catch((err) => {
			console.log(err);
			res.send({ response: "error" });
		});
});

app.get("/all-app-users", async (req, res) => {
	await axios({
		url: "http://127.0.0.1:1337/users",
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
		.then((response) => {
			let sendData = response.data.filter((data) => data.user_role == 4);
			res.send(sendData);
		})
		.catch((err) => {
			console.log(err);
			res.send({ response: "error" });
		});
});

// app.get("/all-app-users", async (req, res) => {
// 	await axios({
// 		url: "http://127.0.0.1:1337/users",
// 		method: "GET",
// 		headers: {
// 			Authorization: req.headers.authorization,
// 		},
// 	})
// 		.then((response) => {
// 			let sendData = response.data.filter((data) => data.user_role == 4);
// 			res.send(sendData);
// 		})
// 		.catch((err) => {
// 			console.log(err);
// 			res.send({ response: "error" });
// 		});
// });

app.get("/all-books-list", async (req, res) => {
	await axios({
		url: "http://127.0.0.1:1337/books",
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
		.then((response) => {
			let tempResponse = response.data.map((temp) => {
				return {
					users_permissions_user: temp.users_permissions_user.id,
					id: temp.id,
					book_pic_url: temp.picture.url,
					book_author_name: temp.book_author.name,
					book_added_date: temp.created_at,
					book_name: temp.name,
					has_mp3: temp.has_audio,
					has_pdf: temp.has_pdf,
					has_sale: temp.has_sale,
				};
			});
			res.send(tempResponse);
		})
		.catch((err) => {
			console.log(err);
			res.send({ response: "error" });
		});
});

app.listen(port, () => {
	console.log(`Example app listening at http://localhost:${port}`);
});
