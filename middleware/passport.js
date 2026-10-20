import passport from "koa-passport"; 

export default app => {
  app.use(passport.initialize());
  app.use(passport.session());
};
