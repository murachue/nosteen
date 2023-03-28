import { Helmet } from "react-helmet";
import { Outlet } from "react-router";

const Global = () => <div style={{ position: "fixed", top: "0", bottom: "0", left: "0", right: "0", backgroundColor: "#444" }}>
    <Helmet>
        <title>nosteen</title>
    </Helmet>
    <Outlet />
</div>;

export default Global;
