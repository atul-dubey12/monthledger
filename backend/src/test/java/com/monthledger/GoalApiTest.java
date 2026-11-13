package com.monthledger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:goals;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH")
@AutoConfigureMockMvc
@DirtiesContext
class GoalApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    private ResultActions send(String method, String url, String body) throws Exception {
        var req = method.equals("POST") ? post(url) : put(url);
        return mvc.perform(req.contentType(MediaType.APPLICATION_JSON).content(body));
    }
    private long createGoal(String body) throws Exception {
        return json.readTree(send("POST", "/api/goals", body).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
    }
    private String saving(String kind, String amount, Long goalId) {
        return "{\"date\":\"2026-11-10\",\"kind\":\"" + kind + "\",\"amount\":" + amount + ",\"categoryId\":17,\"paymentMode\":\"BANK\",\"note\":null,\"goalId\":" + goalId + "}";
    }

    @Test
    void progressIsStartingAmountPlusLinkedSavingsMinusWithdrawals() throws Exception {
        long id = createGoal("{\"name\":\"Emergency fund\",\"icon\":\"🛟\",\"targetAmount\":100000,\"startingAmount\":12000,\"targetDate\":\"2027-12-31\"}");
        send("POST", "/api/entries", saving("SAVING", "6200", id)).andExpect(status().isCreated());
        send("POST", "/api/entries", saving("SAVING", "3000", id)).andExpect(status().isCreated());
        send("POST", "/api/entries", saving("SAVING_WITHDRAWAL", "1200", id)).andExpect(status().isCreated());
        send("POST", "/api/entries", saving("SAVING", "500", null)).andExpect(status().isCreated());   // not linked
        mvc.perform(get("/api/goals")).andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.id == " + id + ")].saved").value(20000.0));
    }

    @Test
    void onlySavingsCanBeLinkedAndHiddenGoalsAreRejected() throws Exception {
        long id = createGoal("{\"name\":\"Bike\",\"icon\":\"🏍️\",\"targetAmount\":80000}");
        send("POST", "/api/entries", "{\"date\":\"2026-11-10\",\"kind\":\"EXPENSE\",\"amount\":100,\"categoryId\":5,\"paymentMode\":\"UPI\",\"note\":null,\"goalId\":" + id + "}")
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("Only savings can count towards a goal."));
        send("PUT", "/api/goals/" + id, "{\"name\":\"Bike\",\"icon\":\"🏍️\",\"targetAmount\":80000,\"archived\":true}")
            .andExpect(status().isOk()).andExpect(jsonPath("$.archived").value(true));
        send("POST", "/api/entries", saving("SAVING", "1000", id)).andExpect(status().isBadRequest());
        send("POST", "/api/entries", saving("SAVING", "1000", 9999L)).andExpect(status().isBadRequest());
    }

    @Test
    void validatesGoals() throws Exception {
        send("POST", "/api/goals", "{\"name\":\" \",\"targetAmount\":1000}").andExpect(status().isBadRequest());
        send("POST", "/api/goals", "{\"name\":\"Trip\",\"targetAmount\":0}").andExpect(status().isBadRequest());
        send("POST", "/api/goals", "{\"name\":\"Trip\",\"targetAmount\":1000,\"startingAmount\":-5}").andExpect(status().isBadRequest());
        send("POST", "/api/goals", "{\"name\":\"Trip\",\"targetAmount\":25000}").andExpect(status().isCreated())
            .andExpect(jsonPath("$.icon").value("🎯")).andExpect(jsonPath("$.saved").value(0));
    }
}
