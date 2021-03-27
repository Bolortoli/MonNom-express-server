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

// var app = express();

// // view engine setup
// app.set("views", path.join(__dirname, "views"));
// app.set("view engine", "pug");

// app.use(logger("dev"));
// app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
app.use(cors());
app.use(bodyParser.json());
app.use(
	bodyParser.urlencoded({
		extended: true,
	})
);
app.use(bodyParser.raw({ type: "*/*" }));
// app.use(bodyParser.raw());
// app.use(cookieParser());
// app.use(express.static(path.join(__dirname, "public")));

// app.use("/", indexRouter);
// app.use("/users", usersRouter);

// // catch 404 and forward to error handler
// app.use(function (req, res, next) {
// 	next(createError(404));
// });

// // error handler
// app.use(function (err, req, res, next) {
// 	// set locals, only providing error in development
// 	res.locals.message = err.message;
// 	res.locals.error = req.app.get("env") === "development" ? err : {};

// 	// render the error page
// 	res.status(err.status || 500);
// 	res.render("error");
// });

// module.exports = app;
// import { login } from "./authentication";

app.post("/admin-login", async (req, res) => {
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
			console.log(err);
			res.send({ response: "error" });
		});
	console.log(req.body);
});

app.get("/all-admins-list", async (req, res) => {
	console.log(req);
	await axios({
		url: "http://127.0.0.1:1337/users",
		method: "GET",
		headers: {
			Authorization: req.headers.authorization,
		},
	})
		.then((response) => {
			console.log("got fcken success");
			console.log(response.data);
			res.send(response.data);
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
			console.log("got fcken success");
			console.log(response.data);
			res.send(response.data);
		})
		.catch((err) => {
			console.log(err);
			res.send({ response: "error" });
		});
});

app.listen(port, () => {
	console.log(`Example app listening at http://localhost:${port}`);
});
